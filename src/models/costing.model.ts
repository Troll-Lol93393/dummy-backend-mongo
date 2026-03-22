import mongoose, { Schema } from "mongoose";

export interface ILabourEntry {
    labourProcessType: mongoose.Types.ObjectId;
    party?: mongoose.Types.ObjectId;
    rate: number;
    rateType: "PER_PIECE" | "PER_KG";
    cost: number;
}

export interface ICosting {
    rfqItem: mongoose.Types.ObjectId;
    rfq: mongoose.Types.ObjectId;

    // Raw material
    diameter: number;
    length: number;
    density: number;
    weight: number;
    materialRate: number;
    rawMaterialParty?: mongoose.Types.ObjectId;
    rawMaterialCost: number;

    // Labour
    labourEntries: ILabourEntry[];
    totalLabourCost: number;

    // Pricing
    costPrice: number;
    profitMargin: number;
    profitAmount: number;
    packingCost: number;
    shippingCost: number;
    otherCosts: number;
    sellingPrice: number;
    totalCost: number;

    isDeleted: boolean;
}

const labourEntrySchema = new Schema<ILabourEntry>(
    {
        labourProcessType: {
            type: Schema.Types.ObjectId,
            ref: "LabourProcessType",
            required: true,
        },
        party: {
            type: Schema.Types.ObjectId,
            ref: "Party",
        },
        rate: {
            type: Number,
            required: true,
            default: 0,
        },
        rateType: {
            type: String,
            enum: ["PER_PIECE", "PER_KG"],
            default: "PER_PIECE",
        },
        cost: {
            type: Number,
            default: 0,
        },
    },
    { _id: true }
);

const costingSchema = new Schema<ICosting>(
    {
        rfqItem: {
            type: Schema.Types.ObjectId,
            ref: "RFQItems",
            required: true,
            index: true,
        },
        rfq: {
            type: Schema.Types.ObjectId,
            ref: "RFQ",
            required: true,
            index: true,
        },
        diameter: { type: Number, default: 0 },
        length: { type: Number, default: 0 },
        density: { type: Number, default: 7.85 },
        weight: { type: Number, default: 0 },
        materialRate: { type: Number, default: 0 },
        rawMaterialParty: {
            type: Schema.Types.ObjectId,
            ref: "Party",
        },
        rawMaterialCost: { type: Number, default: 0 },
        labourEntries: [labourEntrySchema],
        totalLabourCost: { type: Number, default: 0 },
        costPrice: { type: Number, default: 0 },
        profitMargin: { type: Number, default: 0 },
        profitAmount: { type: Number, default: 0 },
        packingCost: { type: Number, default: 0 },
        shippingCost: { type: Number, default: 0 },
        otherCosts: { type: Number, default: 0 },
        sellingPrice: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    { timestamps: true }
);

export const Costing = mongoose.model<ICosting>("Costing", costingSchema);
