import mongoose, { Schema } from "mongoose";

export interface IPurchase {
    vendor?: mongoose.Types.ObjectId;
    item?: mongoose.Types.ObjectId;
    itemCode: string;
    poNumber?: string;
    poDate?: Date;
    purchaseDate: Date;
    jobNumber?: string;
    quantity: number;
    rate: number;
    basicValue: number;
    sgstAmount: number;
    cgstAmount: number;
    igstAmount: number;
    netAmount: number;
    hsnCode?: string;
    deliveryDate?: Date;
    // Not available from the legacy system yet - to be added once the user has it.
    billNumber?: string;
    // Technical dedupe key from the legacy sync (PURCH.CONTRA + PITEM.SRNO) -
    // purchases have no business-facing invoice/bill number, unlike Sales.
    legacyContra: number;
    legacySrno: number;
    legacySource?: Record<string, unknown>;
    isDeleted: boolean;
    deletedAt?: Date;
}

const purchaseSchema: Schema<IPurchase> = new Schema(
    {
        vendor: {
            type: Schema.Types.ObjectId,
            ref: "Party",
        },
        item: {
            type: Schema.Types.ObjectId,
            ref: "Items",
        },
        itemCode: {
            type: String,
            trim: true,
            required: true,
            index: true,
        },
        poNumber: { type: String, trim: true, index: true },
        poDate: { type: Date },
        purchaseDate: {
            type: Date,
            required: true,
            index: true,
        },
        jobNumber: { type: String, trim: true, index: true },
        quantity: { type: Number, default: 0 },
        rate: { type: Number, default: 0 },
        basicValue: { type: Number, default: 0 },
        sgstAmount: { type: Number, default: 0 },
        cgstAmount: { type: Number, default: 0 },
        igstAmount: { type: Number, default: 0 },
        netAmount: { type: Number, default: 0 },
        hsnCode: { type: String, trim: true },
        deliveryDate: { type: Date },
        billNumber: { type: String, trim: true },
        legacyContra: {
            type: Number,
            required: true,
        },
        legacySrno: {
            type: Number,
            required: true,
        },
        legacySource: {
            type: Schema.Types.Mixed,
        },
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

// Natural key for idempotent re-sync: one line per legacy purchase + line number.
purchaseSchema.index(
    { legacyContra: 1, legacySrno: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
);
purchaseSchema.index({ vendor: 1, itemCode: 1 });
purchaseSchema.index({ jobNumber: 1, itemCode: 1 });

export const Purchase = mongoose.model<IPurchase>("Purchase", purchaseSchema);
