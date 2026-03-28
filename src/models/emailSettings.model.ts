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
