import sanitizeHtml from "sanitize-html";

import { IEmail } from "../../models/email.model";
import { getEmailSettings } from "../../models/emailSettings.model";
import { sendMail, SendMailAddress } from "../../utils/mailer";
import { createImapClient } from "./imapService";
import { logger } from "../../utils/logger";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "table", "thead", "tbody", "tr", "th", "td"]),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ["src", "alt", "width", "height"],
        table: ["border", "cellpadding", "cellspacing", "style"],
        td: ["style", "colspan", "rowspan"],
        th: ["style", "colspan", "rowspan"],
        "*": ["style"],
    },
};

export interface SendReplyOptions {
    sourceEmail: Pick<IEmail, "messageId" | "references">;
    to: SendMailAddress[];
    cc?: SendMailAddress[];
    subject: string;
    htmlBody: string;
}

export interface SendReplyResult {
    messageId: string;
}

/**
 * Threaded reply: builds In-Reply-To/References from the source email so the
 * customer's client groups it into the original conversation, sanitizes the
 * drafted HTML before it ever leaves the server, and best-effort appends the
 * sent copy to the mailbox's Sent folder so it shows up there too.
 */
export async function sendReply(options: SendReplyOptions): Promise<SendReplyResult> {
    const sanitizedBody = sanitizeHtml(options.htmlBody, SANITIZE_OPTIONS);
    const settings = await getEmailSettings();
    const html = settings.replySignatureHtml
        ? `${sanitizedBody}<br/>${sanitizeHtml(settings.replySignatureHtml, SANITIZE_OPTIONS)}`
        : sanitizedBody;

    const references = [...(options.sourceEmail.references || []), options.sourceEmail.messageId].filter(
        (id): id is string => Boolean(id)
    );

    const { messageId, raw } = await sendMail({
        to: options.to,
        cc: options.cc,
        subject: options.subject,
        html,
        inReplyTo: options.sourceEmail.messageId,
        references,
    });

    await appendToMailbox(raw, "\\Sent", ["\\Seen"]).catch(err => {
        logger.warn("email:reply", "Failed to append sent reply to IMAP Sent folder", {
            error: (err as Error).message,
        });
    });

    return { messageId };
}

/**
 * Best-effort IMAP APPEND into a special-use mailbox (\Sent, \Drafts, ...).
 * Falls back to a name-prefix match if the server doesn't advertise
 * SPECIAL-USE. Shared by the reply-send path (\Sent) and the Gmail
 * auto-draft path (\Drafts) so both use the same mailbox-resolution logic.
 */
export async function appendToMailbox(raw: Buffer, specialUse: string, flags: string[] = []): Promise<void> {
    const settings = await getEmailSettings();
    if (!settings.imapUser || !settings.imapPassword) return;

    const namePrefix = specialUse.replace(/^\\/, "");
    const client = createImapClient(settings);
    await client.connect();
    try {
        const mailboxes = await client.list();
        const targetMailbox =
            mailboxes.find(mb => mb.specialUse === specialUse) ||
            mailboxes.find(mb => new RegExp(`^${namePrefix}`, "i").test(mb.name));
        if (targetMailbox) {
            await client.append(targetMailbox.path, raw, flags);
        }
    } finally {
        await client.logout();
    }
}
