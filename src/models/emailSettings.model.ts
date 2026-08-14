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
