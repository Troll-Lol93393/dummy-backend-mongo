import mongoose, { Schema } from "mongoose";

// ── Snapshot sub-schemas (frozen copy at generation time) ──

export interface ICommercialSnapshotItem {
    serialNumber: string;
    itemCode: string;
    itemName: string;
    material: string;
    quantity: number;
    sellingPrice: number;
    hsnCode: string;
    gstPercent: number;
    totalBeforeGst: number;
    gstAmount: number;
    totalWithGst: number;
    isRegret: boolean;
    regretReason: string;
}

export interface ICommercialSnapshot {
    prNumber: string;
    companyName: string;
    location: string;
    ownerName: string;
    deliveryWeeks: number;
    items: ICommercialSnapshotItem[];
    grandTotalBeforeGst: number;
    grandGstAmount: number;
    grandTotalWithGst: number;
}

// ── Change request ──

export interface ICommercialChangeRequest {
    itemCode: string;
    field: string;
    currentValue: string;
    requestedValue: string;
    notes: string;
    resolved: boolean;
}

// ── Commercial Offer ──

export type CommercialOfferStatus =
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "REVISION_REQUESTED"
    | "APPROVED"
    | "SUPERSEDED";

export interface ICommercialOffer {
    rfq: mongoose.Types.ObjectId;
    version: number;
    status: CommercialOfferStatus;
    snapshot: ICommercialSnapshot;
    pdfUrl: string;
    excelUrl: string;
    changeRequests: ICommercialChangeRequest[];
    reviewRemarks: string;
    generatedBy: mongoose.Types.ObjectId;
    submittedAt?: Date;
    reviewedAt?: Date;
    approvedBy?: string;
    approvedAt?: Date;
}

const snapshotItemSchema = new Schema<ICommercialSnapshotItem>(
    {
        serialNumber: { type: String, default: "" },
        itemCode: { type: String, default: "" },
        itemName: { type: String, default: "" },
        material: { type: String, default: "" },
        quantity: { type: Number, default: 1 },
        sellingPrice: { type: Number, default: 0 },
        hsnCode: { type: String, default: "84879000" },
        gstPercent: { type: Number, default: 18 },
        totalBeforeGst: { type: Number, default: 0 },
        gstAmount: { type: Number, default: 0 },
        totalWithGst: { type: Number, default: 0 },
        isRegret: { type: Boolean, default: false },
        regretReason: { type: String, default: "" },
    },
    { _id: false }
);

const snapshotSchema = new Schema<ICommercialSnapshot>(
    {
        prNumber: { type: String, default: "" },
        companyName: { type: String, default: "" },
        location: { type: String, default: "" },
        ownerName: { type: String, default: "" },
        deliveryWeeks: { type: Number, default: 0 },
        items: { type: [snapshotItemSchema], default: [] },
        grandTotalBeforeGst: { type: Number, default: 0 },
        grandGstAmount: { type: Number, default: 0 },
        grandTotalWithGst: { type: Number, default: 0 },
    },
    { _id: false }
);

const changeRequestSchema = new Schema<ICommercialChangeRequest>(
    {
        itemCode: { type: String, required: true },
        field: { type: String, required: true },
        currentValue: { type: String, default: "" },
        requestedValue: { type: String, default: "" },
        notes: { type: String, default: "" },
        resolved: { type: Boolean, default: false },
    },
    { _id: true }
);

const commercialOfferSchema = new Schema<ICommercialOffer>(
    {
        rfq: {
            type: Schema.Types.ObjectId,
            ref: "RFQ",
            required: true,
            index: true,
        },
        version: {
            type: Number,
            required: true,
            min: 1,
        },
        status: {
            type: String,
            enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED", "APPROVED", "SUPERSEDED"],
            default: "DRAFT",
        },
        snapshot: {
            type: snapshotSchema,
            required: true,
        },
        pdfUrl: { type: String, default: "" },
        excelUrl: { type: String, default: "" },
        changeRequests: { type: [changeRequestSchema], default: [] },
        reviewRemarks: { type: String, default: "" },
        generatedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        submittedAt: { type: Date },
        reviewedAt: { type: Date },
        approvedBy: { type: String, trim: true },
        approvedAt: { type: Date },
    },
    { timestamps: true }
);

commercialOfferSchema.index({ rfq: 1, version: 1 }, { unique: true });

export const CommercialOffer = mongoose.model<ICommercialOffer>(
    "CommercialOffer",
    commercialOfferSchema
);
