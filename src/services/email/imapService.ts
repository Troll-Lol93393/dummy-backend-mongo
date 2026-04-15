import { ImapFlow, FetchMessageObject } from "imapflow";
import { simpleParser, ParsedMail, Attachment } from "mailparser";
import * as cheerio from "cheerio";
import path from "path";
import fs from "fs";
import os from "os";

import { Email, IEmail, IEmailAttachment, IAribaLink } from "../../models/email.model";
import { getEmailSettings, IEmailSettings, DEFAULT_WHITELIST } from "../../models/emailSettings.model";
import { decryptPassword } from "../../utils/emailEncryption";
import { uploadFileToCloudinary } from "../../utils/cloudinary";
import { logger } from "../../utils/logger";

const ALLOWED_ATTACHMENT_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
];

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Create an IMAP connection using stored settings.
 */
function createImapClient(settings: IEmailSettings): ImapFlow {
    const password = settings.imapPassword ? decryptPassword(settings.imapPassword) : "";
    return new ImapFlow({
        host: settings.imapHost || "imap.gmail.com",
        port: settings.imapPort || 993,
        secure: settings.imapTls !== false,
        auth: {
            user: settings.imapUser,
            pass: password,
        },
        logger: false,
    });
}

/**
 * Check if a URL is an Ariba event/sourcing link (not a support/forgot-password/decline link).
 *
 * Real Ariba URL patterns observed:
 *   Event participation: https://jsw.supplier.ariba.com/ad/webjumper?itemID=...
 *   Document detail:     https://service.ariba.com/Supplier.aw/ad/documentDetail?...
 *   Decline:             https://jsw.supplier.ariba.com/ad/declineToRespond/...  (EXCLUDE)
 *   Password reset:      https://service.ariba.com/Authenticator.aw/ad/pswdReset... (EXCLUDE)
 *   Support (wrapped):   https://urldefense.proofpoint.com/...support.ariba.com... (EXCLUDE)
 *   Footer:              https://www.ariba.com/offices, /legal/..., connect.ariba.com (EXCLUDE)
 */
function isAribaEventLink(href: string): boolean {
    const lower = href.toLowerCase();

    // Must contain ariba.com (not wrapped in proofpoint/urldefense)
    if (!lower.includes("ariba.com")) return false;
    if (lower.includes("urldefense.")) return false;

    // Exclude non-event links
    if (
        lower.includes("declinetorespond") ||
        lower.includes("pswdreset") ||
        lower.includes("forgotpassword") ||
        lower.includes("passwordadapter") ||
        lower.includes("support.ariba.com") ||
        lower.includes("connect.ariba.com") ||
        lower.includes("www.ariba.com/offices") ||
        lower.includes("www.ariba.com/legal") ||
        lower.includes("privacy_statement") ||
        lower.includes("techsupport")
    ) {
        return false;
    }

    // Match: *.supplier.ariba.com/ad/webjumper?itemID=... (event participation link)
    if (/supplier\.ariba\.com\/ad\/webjumper/i.test(href)) return true;

    // Match: service.ariba.com/Supplier.aw/ad/documentDetail (receipt/document links)
    if (/service\.ariba\.com\/Supplier\.aw/i.test(href)) return true;

    // Match: service.ariba.com/...Sourcing.aw (legacy pattern)
    if (/service\.ariba\.com.*Sourcing\.aw/i.test(href)) return true;

    // Match: any ariba.com link with Doc ID (e.g., Doc5619134340)
    if (/ariba\.com/i.test(href) && /Doc\d{5,}/i.test(href)) return true;

    return false;
}

/**
 * Extract Ariba links from email HTML body.
 * Captures event participation links ("Click Here"), sourcing links, and document download links.
 */
function extractAribaLinks(html: string): IAribaLink[] {
    if (!html) return [];
    const $ = cheerio.load(html);
    const links: IAribaLink[] = [];
    const seen = new Set<string>();

    $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (!href || seen.has(href)) return;

        if (isAribaEventLink(href)) {
            seen.add(href);
            links.push({ url: href, downloadStatus: "LINK_EXTRACTED", drawings: [] });
        }
    });

    return links;
}

/**
 * Detect email source based on subject, body, and attachments.
 */
function detectSource(
    subject: string,
    html: string,
    aribaLinks: IAribaLink[],
    attachments: Attachment[]
): "ARIBA" | "DIRECT" | "UNKNOWN" {
    if (
        aribaLinks.length > 0 ||
        subject.toLowerCase().includes("ariba") ||
        (html && /ariba\.com/i.test(html)) ||
        /ansmtp\.ariba\.com/.test(subject)
    ) {
        return "ARIBA";
    }

    const hasDocAttachment = attachments.some(
        a => a.contentType && ALLOWED_ATTACHMENT_TYPES.includes(a.contentType)
    );
    if (hasDocAttachment) return "DIRECT";

    return "UNKNOWN";
}

/**
 * Upload a single attachment to Cloudinary, return metadata.
 */
async function uploadAttachment(att: Attachment): Promise<IEmailAttachment> {
    const result: IEmailAttachment = {
        filename: att.filename || "unnamed",
        contentType: att.contentType || "application/octet-stream",
        size: att.size || 0,
    };

    // Only upload allowed types under size limit
    if (
        att.content &&
        ALLOWED_ATTACHMENT_TYPES.includes(att.contentType || "") &&
        att.size <= MAX_ATTACHMENT_SIZE
    ) {
        const tmpDir = os.tmpdir();
        const tmpPath = path.join(tmpDir, `email_att_${Date.now()}_${att.filename || "file"}`);
        try {
            fs.writeFileSync(tmpPath, att.content);
            const cloudResult = await uploadFileToCloudinary(tmpPath);
            if (cloudResult) {
                result.cloudinaryUrl = cloudResult.secure_url;
                result.cloudinaryPublicId = cloudResult.public_id;
            }
        } catch (err) {
            logger.error("IMAP", `Failed to upload attachment ${att.filename}`, {
                error: String(err),
            });
        } finally {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }
    }

    return result;
}

/**
 * Parse a raw email message into our Email document fields.
 */
async function parseMessage(
    raw: Buffer,
    uid: number
): Promise<Partial<IEmail> | null> {
    const parsed: ParsedMail = await simpleParser(raw);

    if (!parsed.messageId) return null;

    const htmlBody = parsed.html || "";
    const aribaLinks = extractAribaLinks(htmlBody);

    const attachments: IEmailAttachment[] = [];
    if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
            const uploaded = await uploadAttachment(att);
            attachments.push(uploaded);
        }
    }

    const source = detectSource(
        parsed.subject || "",
        htmlBody,
        aribaLinks,
        parsed.attachments || []
    );

    return {
        messageId: parsed.messageId,
        uid,
        from: {
            name: parsed.from?.value?.[0]?.name || "",
            address: parsed.from?.value?.[0]?.address || "",
        },
        to: (parsed.to
            ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                  .flatMap(t => t.value)
                  .map(v => ({ name: v.name || "", address: v.address || "" }))
            : []),
        cc: (parsed.cc
            ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
                  .flatMap(c => c.value)
                  .map(v => ({ name: v.name || "", address: v.address || "" }))
            : []),
        subject: parsed.subject || "",
        textBody: parsed.text || "",
        htmlBody,
        date: parsed.date || new Date(),
        attachments,
        aribaLinks,
        source,
        isRead: false,
        isProcessed: false,
        isArchived: false,
        isDeleted: false,
    };
}

/**
 * Check if sender email is whitelisted.
 */
function isSenderAllowed(fromAddress: string, customWhitelist: string[]): boolean {
    if (!fromAddress) return false;
    const addr = fromAddress.toLowerCase();
    const allPatterns = [...DEFAULT_WHITELIST, ...customWhitelist].map(p => p.toLowerCase().trim());
    return allPatterns.some(pattern => {
        if (pattern.startsWith("@")) {
            // Domain match
            return addr.endsWith(pattern);
        }
        // Exact address match
        return addr === pattern;
    });
}

/** Max emails to fetch per sync run (keeps it fast) */
const SYNC_BATCH_SIZE = 50;

/**
 * Sync emails from IMAP server. Returns count of new emails saved.
 */
export async function syncEmails(): Promise<number> {
    const settings = await getEmailSettings();
    if (!settings.imapUser || !settings.imapPassword) {
        logger.warn("IMAP", "IMAP credentials not configured, skipping sync");
        return 0;
    }

    const client = createImapClient(settings);
    let newCount = 0;

    try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
            const mailboxStatus = client.mailbox;
            const rawExists = mailboxStatus && typeof mailboxStatus === "object" && "exists" in mailboxStatus
                ? (mailboxStatus as { exists: number | bigint }).exists
                : 0;
            const totalMessages = Number(rawExists);
            logger.info("IMAP", `Mailbox: ${totalMessages} messages (raw type: ${typeof rawExists})`);

            if (totalMessages === 0) {
                logger.info("IMAP", "Inbox appears empty or mailbox status unavailable");
                settings.lastSyncAt = new Date();
                await settings.save();
                return 0;
            }

            const lastUid = settings.lastSyncUid ?? 0;
            const isIncremental = lastUid > 0;

            logger.info("IMAP", `Mailbox has ${totalMessages} messages, lastSyncUid=${lastUid}, incremental=${isIncremental}`);

            // For initial sync, use sequence-based search to get last N messages
            // For incremental sync, use UID-based search
            const messages: FetchMessageObject[] = [];

            if (isIncremental) {
                const fetchRange = `${lastUid + 1}:*`;
                logger.info("IMAP", `Incremental UID fetch: ${fetchRange}`);
                for await (const msg of client.fetch(fetchRange, { source: true, uid: true }, { uid: true })) {
                    messages.push(msg);
                }
            } else {
                // Use IMAP SEARCH to get the last N message sequence numbers, then FETCH them
                const startSeq = Math.max(1, totalMessages - SYNC_BATCH_SIZE + 1);
                const fetchRange = `${startSeq}:*`;
                logger.info("IMAP", `Initial sequence fetch: ${fetchRange} (${totalMessages} total)`);
                for await (const msg of client.fetch(fetchRange, { source: true, uid: true })) {
                    messages.push(msg);
                }
            }

            logger.info("IMAP", `Fetched ${messages.length} message(s) from server`);

            let maxUid = settings.lastSyncUid || 0;
            const customWhitelist = settings.senderWhitelist || [];
            let skippedCount = 0;

            for (const msg of messages) {
                try {
                    // Skip if we already have this UID and it's not greater
                    if (settings.lastSyncUid && msg.uid <= settings.lastSyncUid) continue;

                    const emailData = await parseMessage(
                        msg.source as Buffer,
                        msg.uid
                    );
                    if (!emailData || !emailData.messageId) {
                        if (msg.uid > maxUid) maxUid = msg.uid;
                        continue;
                    }

                    // Filter: only allow whitelisted senders
                    const senderAddr = emailData.from?.address || "";
                    if (!isSenderAllowed(senderAddr, customWhitelist)) {
                        skippedCount++;
                        if (msg.uid > maxUid) maxUid = msg.uid;
                        continue;
                    }

                    // Dedup by messageId (unique index handles race conditions)
                    const exists = await Email.findOne({ messageId: emailData.messageId });
                    if (exists) {
                        if (msg.uid > maxUid) maxUid = msg.uid;
                        continue;
                    }

                    await Email.create(emailData);
                    newCount++;

                    if (msg.uid > maxUid) maxUid = msg.uid;
                } catch (err: unknown) {
                    // Skip duplicate key errors (concurrent sync)
                    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
                        if (msg.uid > maxUid) maxUid = msg.uid;
                        continue;
                    }
                    logger.error("IMAP", `Failed to process message UID ${msg.uid}`, {
                        error: String(err),
                    });
                }
            }

            if (skippedCount > 0) {
                logger.info("IMAP", `Skipped ${skippedCount} emails from non-whitelisted senders`);
            }

            // Update sync state
            if (maxUid > (settings.lastSyncUid || 0)) {
                settings.lastSyncUid = maxUid;
            }
            settings.lastSyncAt = new Date();
            await settings.save();
        } finally {
            lock.release();
        }
    } catch (err) {
        logger.error("IMAP", "IMAP sync failed", { error: String(err) });
        throw err;
    } finally {
        try {
            await client.logout();
        } catch {
            // Ignore logout errors
        }
    }

    logger.info("IMAP", `Sync complete — ${newCount} new emails`);
    return newCount;
}

/**
 * Re-extract Ariba links from existing emails that have HTML body but empty aribaLinks.
 * Useful after updating the link extraction logic.
 */
export async function reExtractAribaLinks(): Promise<number> {
    const emails = await Email.find({
        isDeleted: false,
        htmlBody: { $exists: true, $ne: "" },
        $or: [
            { aribaLinks: { $size: 0 } },
            { aribaLinks: { $exists: false } },
        ],
    });

    let updated = 0;
    for (const email of emails) {
        const links = extractAribaLinks(email.htmlBody);
        if (links.length > 0) {
            email.aribaLinks = links as typeof email.aribaLinks;
            // Also update source if it was UNKNOWN
            if (email.source === "UNKNOWN") {
                email.source = "ARIBA";
            }
            await email.save();
            updated++;
            logger.info("IMAP", `Re-extracted ${links.length} Ariba link(s) from "${email.subject}"`);
        }
    }

    return updated;
}

/**
 * Test IMAP connection with given credentials.
 */
export async function testImapConnection(
    host: string,
    port: number,
    user: string,
    password: string,
    tls: boolean
): Promise<{ success: boolean; message: string; mailboxCount?: number }> {
    const client = new ImapFlow({
        host,
        port,
        secure: tls,
        auth: { user, pass: password },
        logger: false,
    });

    try {
        await client.connect();
        const mailbox = await client.status("INBOX", { messages: true });
        await client.logout();
        return {
            success: true,
            message: `Connected successfully. Inbox has ${mailbox.messages} messages.`,
            mailboxCount: mailbox.messages,
        };
    } catch (err) {
        return {
            success: false,
            message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
