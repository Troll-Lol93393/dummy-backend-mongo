import mongoose, { Schema } from "mongoose";

export interface IClient {
    companyName: string;
    gstn: string;
    location: string;
    addressLine1: string;
    addressLine2: string;
    addressLine3: string;
    state: string;
    city: string;
    pincode: string;
    country: string;
    buyerName: string;
    buyerContact: string;
    // Legacy MASTER.CODE - dedupe key used by the legacy sync (see jow-legacy-sync).
    legacyCode?: string;
    legacySource?: Record<string, unknown>;
    isDeleted: boolean;
}

export const clientSchema: Schema<IClient> = new Schema(
    {
        companyName: {
            type: String,
            required: [true, "Company name is required !"],
            trim: true,
        },
        gstn: {
            type: String,
            trim: true,
        },
        location: {
            type: String,
            trim: true,
        },
        addressLine1: {
            type: String,
            trim: true,
        },
        addressLine2: {
            type: String,
            trim: true,
        },
        addressLine3: {
            type: String,
            trim: true,
        },
        state: {
            type: String,
            trim: true,
        },
        city: {
            type: String,
            trim: true,
        },
        pincode: {
            type: String,
            trim: true,
        },
        country: {
            type: String,
            trim: true,
        },
        buyerName: {
            type: String,
            trim: true,
        },
        buyerContact: {
            type: String,
            trim: true,
        },
        legacyCode: {
            type: String,
            trim: true,
            index: { unique: true, sparse: true },
        },
        legacySource: {
            type: Schema.Types.Mixed,
        },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Unique companyName only among non-deleted clients (allows re-adding after soft delete)
clientSchema.index(
    { companyName: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
);

export const Client = mongoose.model<IClient>("Client", clientSchema);
