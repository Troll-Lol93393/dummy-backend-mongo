import { Email } from "../../models/email.model";
import { getEmailSettings } from "../../models/emailSettings.model";
import { matchDispatchRequests } from "./dispatchMatchingService";
import { generateDispatchStatusDraftHtml } from "./dispatchDraftGenerationService";
import { buildMimeMessage } from "../../utils/mailer";
import { appendToMailbox } from "./replySenderService";
import { createImapClient } from "./imapService";
import { logger } from "../../utils/logger";

const BATCH_LIMIT = 20;

function toReplySubject(subject: string): string {
    return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

/**
 * Auto-creates a Gmail draft (IMAP-appended to \Drafts, never sent) for
 * DISPATCH_STATUS_REQUEST emails. Every PO/item line that resolves to a real
 * PO gets a line in the draft: dispatched lines carry real invoice/date/qty,
 * anything still owed (partial or fully pending) gets a standard placeholder
 * sentence instead of being silently omitted. Only a PO that isn't in our
 * records at all produces no usable line, so if every requested PO comes
 * back PO_NOT_FOUND, no draft is created and the email is retried on the
 * next cycle. Since this only ever creates a draft (never sends), a human
 * always reviews and can edit the placeholder wording before it goes out.
 *
 * Fully gated by settings.autoGmailDraftEnabled: when off, this returns
 * immediately after the settings read — no candidate query, no IMAP
 * connection, nothing else runs.
 */
export async function createDispatchDraftsInGmail(): Promise<number> {
    const settings = await getEmailSettings();
    if (!settings.autoGmailDraftEnabled) return 0;

    const candidates = await Email.find({
        isDeleted: false,
        "classification.category": "DISPATCH_STATUS_REQUEST",
        dispatchDraftStatus: "NONE",
        "dispatchRequests.0": { $exists: true },
    })
        .sort({ date: -1 })
        .limit(BATCH_LIMIT);

    let created = 0;
    for (const email of candidates) {
        try {
            const matches = await matchDispatchRequests(email.dispatchRequests);
            const draftable = matches.filter(m => m.status !== "PO_NOT_FOUND");
            if (draftable.length === 0) continue;

            const html = generateDispatchStatusDraftHtml(draftable);
            const { raw, messageId } = await buildMimeMessage({
                to: [{ name: email.from.name, address: email.from.address }],
                subject: toReplySubject(email.subject),
                html,
                inReplyTo: email.messageId,
                references: [...(email.references || []), email.messageId].filter(
                    (id): id is string => Boolean(id)
                ),
            });

            await appendToMailbox(raw, "\\Drafts", ["\\Draft"]);

            email.dispatchDraftStatus = "DRAFT_CREATED";
            email.dispatchDraftMessageId = messageId;
            email.dispatchDraftCreatedAt = new Date();
            await email.save();
            created += 1;
        } catch (err) {
            logger.error("DISPATCH_DRAFT", `Failed to create Gmail draft for email ${email._id}`, {
                error: String(err),
            });
        }
    }

    return created;
}

/**
 * Detects drafts sent from Gmail itself — the customer's reply already went
 * out, so this app's job is just to reflect that in the UI. Checks whether
 * the draft's Message-ID now appears in the Sent folder. Same toggle-gating
 * as creation: settings.autoGmailDraftEnabled must be on.
 */
export async function checkSentDispatchDrafts(): Promise<number> {
    const settings = await getEmailSettings();
    if (!settings.autoGmailDraftEnabled) return 0;
    if (!settings.imapUser || !settings.imapPassword) return 0;

    const pending = await Email.find({
        isDeleted: false,
        dispatchDraftStatus: "DRAFT_CREATED",
        dispatchDraftMessageId: { $exists: true, $ne: "" },
    }).limit(BATCH_LIMIT);

    if (pending.length === 0) return 0;

    const client = createImapClient(settings);
    await client.connect();
    let updated = 0;
    try {
        const mailboxes = await client.list();
        const sentMailbox =
            mailboxes.find(mb => mb.specialUse === "\\Sent") ||
            mailboxes.find(mb => /^sent/i.test(mb.name));
        if (!sentMailbox) return 0;

        await client.mailboxOpen(sentMailbox.path, { readOnly: true });

        for (const email of pending) {
            try {
                const uids = await client.search(
                    { header: { "message-id": email.dispatchDraftMessageId! } },
                    { uid: true }
                );
                if (uids && uids.length > 0) {
                    email.dispatchDraftStatus = "SENT";
                    email.dispatchDraftSentAt = new Date();
                    await email.save();
                    updated += 1;
                }
            } catch (err) {
                logger.error(
                    "DISPATCH_DRAFT",
                    `Failed to check sent-status for email ${email._id}`,
                    {
                        error: String(err),
                    }
                );
            }
        }
    } finally {
        await client.logout();
    }

    return updated;
}
