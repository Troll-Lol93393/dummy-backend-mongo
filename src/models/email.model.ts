import mongoose, { Schema } from "mongoose";

export const EMAIL_CATEGORIES = [
    "NEW_RFQ",
    "RFQ_REMINDER",
    "RFQ_REOPENED",
    "REVISION_NEGOTIATION",
    "PO_RELATED",
    "PO_DISCUSSION",
    "DELIVERY_SCHEDULE",
    "MATERIAL_NOT_RECEIVED",
    "DRAWING_DOCUMENT",
    "GENERAL",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export type AribaDownloadStatus = "LINK_EXTRACTED" | "DOWNLOADING" | "DOWNLOADED" | "FAILED";

export type EmailSource = "ARIBA" | "DIRECT" | "UNKNOWN";

export interface IEmailAttachment {
    filename: string;
    contentType: string;
    size: number;
    cloudinaryUrl?: string;
    cloudinaryPublicId?: string;
}

export interface IAribaLink {
    url: string;
    downloadedDocUrl?: string;
    downloadStatus: AribaDownloadStatus;
    errorMessage?: string;
}

export interface IEmailClassification {
    category: EmailCategory;
    confidence: number;
    extractedData: {
        prNumbers: string[];
        poNumbers: string[];
        companyNames: string[];
        contactPerson?: string;
        contactEmail?: string;
        contactPhone?: string;
        location?: string;
        eventStartDate?: Date;
        dueDate?: Date;
        actionItems: string[];
        summary: string;
    };
}

export interface IEmail {
    messageId: string;
    uid: number;
    from: { name: string; address: string };
    to: { name: string; address: string }[];
    cc: { name: string; address: string }[];
    subject: string;
    textBody: string;
    htmlBody: string;
    date: Date;
    attachments: IEmailAttachment[];
    aribaLinks: IAribaLink[];
    classification: IEmailClassification;
    linkedRfq?: mongoose.Types.ObjectId;
    isRead: boolean;
    isProcessed: boolean;
    isArchived: boolean;
    isDeleted: boolean;
    source: EmailSource;
}

const emailAttachmentSchema = new Schema<IEmailAttachment>(
    {
        filename: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true },
        cloudinaryUrl: { type: String },
        cloudinaryPublicId: { type: String },
    },
    { _id: true }
);

const aribaLinkSchema = new Schema<IAribaLink>(
    {
        url: { type: String, required: true },
        downloadedDocUrl: { type: String },
        downloadStatus: {
            type: String,
            enum: ["LINK_EXTRACTED", "DOWNLOADING", "DOWNLOADED", "FAILED"],
            default: "LINK_EXTRACTED",
        },
        errorMessage: { type: String },
    },
    { _id: true }
);

const emailClassificationSchema = new Schema<IEmailClassification>(
    {
        category: {
            type: String,
            enum: EMAIL_CATEGORIES,
            default: "GENERAL",
        },
        confidence: { type: Number, default: 0, min: 0, max: 100 },
        extractedData: {
            prNumbers: [{ type: String }],
            poNumbers: [{ type: String }],
            companyNames: [{ type: String }],
            contactPerson: { type: String },
            contactEmail: { type: String },
            contactPhone: { type: String },
            location: { type: String },
            eventStartDate: { type: Date },
            dueDate: { type: Date },
            actionItems: [{ type: String }],
            summary: { type: String, default: "" },
        },
    },
    { _id: false }
);

const emailSchema = new Schema<IEmail>(
    {
        messageId: {
            type: String,
            required: [true, "Message ID is required"],
            unique: true,
            index: true,
        },
        uid: { type: Number, required: true },
        from: {
            name: { type: String, default: "" },
            address: { type: String, default: "" },
        },
        to: [
            {
                name: { type: String, default: "" },
                address: { type: String, default: "" },
            },
        ],
        cc: [
            {
                name: { type: String, default: "" },
                address: { type: String, default: "" },
            },
        ],
        subject: { type: String, default: "", trim: true },
        textBody: { type: String, default: "" },
        htmlBody: { type: String, default: "" },
        date: { type: Date, required: true, index: true },
        attachments: [emailAttachmentSchema],
        aribaLinks: [aribaLinkSchema],
        classification: {
            type: emailClassificationSchema,
            default: () => ({
                category: "GENERAL",
                confidence: 0,
                extractedData: {
                    prNumbers: [],
                    poNumbers: [],
                    companyNames: [],
                    actionItems: [],
                    summary: "",
                },
            }),
        },
        linkedRfq: { type: Schema.Types.ObjectId, ref: "RFQ", index: true },
        isRead: { type: Boolean, default: false, index: true },
        isProcessed: { type: Boolean, default: false, index: true },
        isArchived: { type: Boolean, default: false },
        isDeleted: { type: Boolean, default: false },
        source: {
            type: String,
            enum: ["ARIBA", "DIRECT", "UNKNOWN"],
            default: "UNKNOWN",
        },
    },
    { timestamps: true }
);

emailSchema.index({ "classification.category": 1 });

export const Email = mongoose.model<IEmail>("Email", emailSchema);
