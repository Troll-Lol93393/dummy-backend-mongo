import mongoose, { Schema } from "mongoose";

export interface IEmailSettings {
    imapHost: string;
    imapPort: number;
    imapUser: string;
    imapPassword: string;
    imapTls: boolean;
    syncEnabled: boolean;
    syncIntervalMinutes: number;
    lastSyncAt?: Date;
    lastSyncUid?: number;
    aribaUsername: string;
    aribaPassword: string;
    aribaAutoDownload: boolean;
    senderWhitelist: string[];
    // Outbound (reply) SMTP config. A reply must originate from the same
    // mailbox that received the request so the customer's reply-to-the-reply
    // threads back into the synced inbox — default these to the IMAP
    // credentials above when unset (see getSmtpCredentials in mailer.ts).
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    smtpSecure: boolean;
    fromName: string;
    replySignatureHtml: string;
    // When on, DISPATCH_STATUS_REQUEST emails with at least one dispatched
    // PO/item get a Gmail draft created automatically (IMAP APPEND to the
    // \Drafts folder — never sent). When off, the scheduler skips this
    // entirely: no matching, no IMAP connection, nothing runs.
    autoGmailDraftEnabled: boolean;
    // When off (default), the scheduler never auto-downloads-and-extracts an
    // RFQ from Ariba documents — that work is currently deprioritized in
    // favor of the email/dispatch-status pipeline. Manual RFQ creation via
    // the UI is unaffected either way.
    autoCreateRfqEnabled: boolean;
    // When on, the payment-reconciliation pipeline auto-creates Gmail drafts
    // (IMAP APPEND to \Drafts, never sent) for: (a) SHORT_PAYMENT invoice
    // rows querying JSW's vendor help desk, and (b) invoices >45 days overdue
    // with no payment received at all. When off, ingestion/matching still
    // runs (it's just data logging) — only these outbound drafts are gated.
    autoPaymentFollowUpEnabled: boolean;
}

/** Default domains to always allow */
export const DEFAULT_WHITELIST = [
    "@jsw.in",
    "@ariba.com",
    "@ansmtp.ariba.com",
    "@timken.com",
    "@jindalsteel.com",
    "@jindalstainless.com",
    "@jswgbs.com",
    "@jsw.co.in",
    // SBI CMP ePayment Advice — automated bank payment notifications feeding
    // the payment-reconciliation pipeline (see paymentAdviceExtractionService.ts).
    "support.cmpcorp@alerts.sbi.bank.in",
];

const emailSettingsSchema = new Schema<IEmailSettings>(
    {
        imapHost: { type: String, default: "imap.gmail.com" },
        imapPort: { type: Number, default: 993 },
        imapUser: { type: String, default: "" },
        imapPassword: { type: String, default: "" },
        imapTls: { type: Boolean, default: true },
        syncEnabled: { type: Boolean, default: false },
        syncIntervalMinutes: { type: Number, default: 10, min: 5, max: 60 },
        lastSyncAt: { type: Date },
        lastSyncUid: { type: Number },
        aribaUsername: { type: String, default: "" },
        aribaPassword: { type: String, default: "" },
        aribaAutoDownload: { type: Boolean, default: false },
        senderWhitelist: { type: [String], default: [] },
        smtpHost: { type: String, default: "smtp.gmail.com" },
        smtpPort: { type: Number, default: 587 },
        smtpUser: { type: String, default: "" },
        smtpPassword: { type: String, default: "" },
        smtpSecure: { type: Boolean, default: false },
        fromName: { type: String, default: "" },
        replySignatureHtml: { type: String, default: "" },
        autoGmailDraftEnabled: { type: Boolean, default: false },
        autoCreateRfqEnabled: { type: Boolean, default: false },
    },
    { timestamps: true }
);

export const EmailSettings = mongoose.model<IEmailSettings>(
    "EmailSettings",
    emailSettingsSchema
);

/**
 * Get or create the singleton settings document.
 */
export async function getEmailSettings(): Promise<
    mongoose.Document<unknown, object, IEmailSettings> & IEmailSettings
> {
    let settings = await EmailSettings.findOne();
    if (!settings) {
        settings = await EmailSettings.create({});
    }
    return settings;
}
