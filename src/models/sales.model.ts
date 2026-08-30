import mongoose, { Schema } from "mongoose";

export interface ISales {
    legacyContra?: number;
    legacySrno?: number;
    invoiceNumber: string;
    invoiceDate: Date;
    dispatchDate: Date;
    // Indian financial year (Apr-Mar) the dispatch falls in, e.g. "2025-26".
    // Computed at import time from dispatchDate — denormalized for cheap filtering.
    financialYear: string;
    poReference: string;
    poNumber?: string;
    companyName: string;
    gstin?: string;
    // Alphanumeric LR/consignment number. Not yet populated by the source
    // system for historical invoices, but a required field going forward —
    // do not remove or repurpose this even though it's empty today.
    consignmentNumber?: string;
    // JSW's 17-digit VSC barcode number for this invoice/dispatch. Manually
    // entered — not yet populated for historical records, may be empty.
    // Used by the payment-reconciliation follow-up drafts (Template 3).
    barcode?: string;
    transporterId?: number;
    transporterName?: string;
    transporterGstin?: string;
    ewayBillNumber?: string;
    serialNumber: number;
    itemCode: string;
    itemName: string;
    materialRemarks?: string;
    drawingNumber?: string;
    uom?: string;
    quantity: number;
    rate: number;
    basicValue: number;
    sgstAmount: number;
    cgstAmount: number;
    igstAmount: number;
    netAmount: number;
    status: "DISPATCHED" | "CANCELLED";
    poRegister?: mongoose.Types.ObjectId;
    item?: mongoose.Types.ObjectId;
    sourceFileName?: string;
    sourceRowNumber?: number;
    // Carried over from the legacy SALES sync - see jow-legacy-sync.
    jobNumber?: string;
    deliveryDate?: Date;
    cancelDate?: Date;
    irn?: string;
    irnDate?: Date;
    legacySource?: Record<string, unknown>;
    isDeleted: boolean;
    deletedAt?: Date;
}

const salesSchema: Schema<ISales> = new Schema(
    {
        legacyContra: { type: Number, index: true },
        legacySrno: { type: Number },
        invoiceNumber: {
            type: String,
            required: [true, "Invoice number is required"],
            trim: true,
            index: true,
        },
        invoiceDate: {
            type: Date,
            required: true,
            index: true,
        },
        dispatchDate: {
            type: Date,
            required: true,
        },
        financialYear: {
            type: String,
            trim: true,
            index: true,
        },
        poReference: {
            type: String,
            trim: true,
            default: "",
        },
        poNumber: {
            type: String,
            trim: true,
            index: true,
        },
        companyName: {
            type: String,
            trim: true,
            default: "",
            index: true,
        },
        gstin: {
            type: String,
            trim: true,
        },
        consignmentNumber: {
            type: String,
            trim: true,
        },
        barcode: {
            type: String,
            trim: true,
            index: true,
        },
        transporterId: {
            type: Number,
        },
        transporterName: {
            type: String,
            trim: true,
        },
        transporterGstin: {
            type: String,
            trim: true,
        },
        ewayBillNumber: {
            type: String,
            trim: true,
            index: true,
        },
        serialNumber: {
            type: Number,
            required: true,
        },
        itemCode: {
            type: String,
            trim: true,
            required: true,
            index: true,
        },
        itemName: {
            type: String,
            trim: true,
            default: "",
        },
        materialRemarks: {
            type: String,
            trim: true,
        },
        drawingNumber: {
            type: String,
            trim: true,
        },
        uom: {
            type: String,
            trim: true,
        },
        quantity: {
            type: Number,
            default: 0,
        },
        rate: {
            type: Number,
            default: 0,
        },
        basicValue: {
            type: Number,
            default: 0,
        },
        sgstAmount: {
            type: Number,
            default: 0,
        },
        cgstAmount: {
            type: Number,
            default: 0,
        },
        igstAmount: {
            type: Number,
            default: 0,
        },
        netAmount: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: ["DISPATCHED", "CANCELLED"],
            default: "DISPATCHED",
        },
        poRegister: {
            type: Schema.Types.ObjectId,
            ref: "PORegister",
        },
        item: {
            type: Schema.Types.ObjectId,
            ref: "Items",
        },
        sourceFileName: {
            type: String,
            trim: true,
        },
        sourceRowNumber: {
            type: Number,
        },
        jobNumber: { type: String, trim: true },
        deliveryDate: { type: Date },
        cancelDate: { type: Date },
        irn: { type: String, trim: true },
        irnDate: { type: Date },
        legacySource: { type: Schema.Types.Mixed },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

// Legacy SALES reuses invoice numbers; synced rows are identified by CONTRA+SRNO.
salesSchema.index(
    { legacyContra: 1, legacySrno: 1 },
    {
        unique: true,
        partialFilterExpression: {
            isDeleted: false,
            legacyContra: { $exists: true },
            legacySrno: { $exists: true },
        },
    }
);
salesSchema.index({ poNumber: 1, itemCode: 1 });
salesSchema.index({ invoiceDate: -1 });

export const Sales = mongoose.model<ISales>("Sales", salesSchema);
