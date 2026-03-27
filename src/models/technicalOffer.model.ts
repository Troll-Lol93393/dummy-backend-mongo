import mongoose, { Schema } from "mongoose";

// ── Snapshot sub-schemas (frozen copy of data at generation time) ──

export interface ISnapshotHardness {
    hardnessType: string;
    value: string;
    measurement: string;
}

export interface ISnapshotBomEntry {
    partName: string;
    material: string;
    grade: string;
    quantity: number;
    hardness: ISnapshotHardness[];
    remarks: string;
}

export interface ISnapshotItem {
    serialNumber: string;
    itemCode: string;
    itemName: string;
    itemDesc: string;
    itemType: string;
    quantity: number;
    drawingNumber: string;
    material: string;
    grade: string;
    hardness: ISnapshotHardness[];
    remarks: string;
    bom: ISnapshotBomEntry[];
    isRegret: boolean;
    regretReason: string;
}

export interface ISnapshot {
    prNumber: string;
    companyName: string;
    location: string;
    ownerName: string;
    deliveryWeeks: number;
    items: ISnapshotItem[];
}

// ── Change request ──

export interface IChangeRequest {
    itemCode: string;
    field: string;
    currentValue: string;
    requestedValue: string;
    notes: string;
    resolved: boolean;
}

// ── Technical Offer ──

export type TechOfferStatus =
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "REVISION_REQUESTED"
    | "APPROVED"
    | "SUPERSEDED";

export interface ITechnicalOffer {
    rfq: mongoose.Types.ObjectId;
    version: number;
    status: TechOfferStatus;
    snapshot: ISnapshot;
    pdfUrl: string;
    excelUrl: string;
    changeRequests: IChangeRequest[];
    reviewRemarks: string;
    generatedBy: mongoose.Types.ObjectId;
    submittedAt?: Date;
    reviewedAt?: Date;
    approvedBy?: string;
    approvedAt?: Date;
}

const snapshotHardnessSchema = new Schema<ISnapshotHardness>(
    {
        hardnessType: { type: String, default: "" },
        value: { type: String, default: "" },
        measurement: { type: String, default: "" },
    },
    { _id: false }
);

const snapshotBomSchema = new Schema<ISnapshotBomEntry>(
    {
        partName: { type: String, default: "" },
        material: { type: String, default: "" },
        grade: { type: String, default: "" },
        quantity: { type: Number, default: 1 },
        hardness: { type: [snapshotHardnessSchema], default: [] },
        remarks: { type: String, default: "" },
    },
    { _id: false }
);

const snapshotItemSchema = new Schema<ISnapshotItem>(
    {
        serialNumber: { type: String, default: "" },
        itemCode: { type: String, default: "" },
        itemName: { type: String, default: "" },
        itemDesc: { type: String, default: "" },
        itemType: { type: String, default: "UNIT" },
        quantity: { type: Number, default: 1 },
        drawingNumber: { type: String, default: "" },
        material: { type: String, default: "" },
        grade: { type: String, default: "" },
        hardness: { type: [snapshotHardnessSchema], default: [] },
        remarks: { type: String, default: "" },
        bom: { type: [snapshotBomSchema], default: [] },
        isRegret: { type: Boolean, default: false },
        regretReason: { type: String, default: "" },
    },
    { _id: false }
);

const snapshotSchema = new Schema<ISnapshot>(
    {
        prNumber: { type: String, default: "" },
        companyName: { type: String, default: "" },
        location: { type: String, default: "" },
        ownerName: { type: String, default: "" },
        deliveryWeeks: { type: Number, default: 0 },
        items: { type: [snapshotItemSchema], default: [] },
    },
    { _id: false }
);

const changeRequestSchema = new Schema<IChangeRequest>(
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

const technicalOfferSchema = new Schema<ITechnicalOffer>(
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

// Compound index: one RFQ + version combo must be unique
technicalOfferSchema.index({ rfq: 1, version: 1 }, { unique: true });

export const TechnicalOffer = mongoose.model<ITechnicalOffer>(
    "TechnicalOffer",
    technicalOfferSchema
);
