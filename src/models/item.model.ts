import mongoose, { Schema } from "mongoose";

export interface IBomHardness {
    hardnessType: string;
    value: string;
    measurement: string;
}

export interface IBomEntry {
    partName: string;
    partDescription?: string;
    material?: string;
    quantity: number;
    diameter?: string;
    length?: string;
    weight?: string;
    density?: string;
    grade?: string;
    make?: string;
    remarks?: string;
    hardness?: IBomHardness[];
}

export interface IItemHardness {
    hardnessType: string;
    value: string;
    measurement: string;
}

export interface Items {
    itemCode: string;
    itemName: string;
    itemDesc: string;
    itemType: "SET" | "ASSEMBLY" | "UNIT";
    size?: string;
    bom?: IBomEntry[];
    // Carried over from the legacy ITEMMAST/ITEMDTL sync - see jow-legacy-sync.
    drawingNumber?: string;
    uom?: string;
    hsnCode?: string;
    ut?: string;
    moc?: string;
    testing?: string;
    hardness?: IItemHardness[];
    // Full raw legacy row, for fields not otherwise captured above.
    legacySource?: Record<string, unknown>;
    isDeleted?: boolean;
    deletedAt?: Date;
}

const bomHardnessSchema = new Schema<IBomHardness>(
    {
        hardnessType: { type: String, trim: true },
        value: { type: String, trim: true },
        measurement: { type: String, trim: true },
    },
    { _id: true }
);

const bomEntrySchema = new Schema<IBomEntry>(
    {
        partName: {
            type: String,
            trim: true,
            required: [true, "Part name is required"],
        },
        partDescription: {
            type: String,
            trim: true,
        },
        material: {
            type: String,
            trim: true,
        },
        quantity: {
            type: Number,
            required: [true, "Part quantity is required"],
            min: 1,
            default: 1,
        },
        diameter: { type: String, trim: true },
        length: { type: String, trim: true },
        weight: { type: String, trim: true },
        density: { type: String, trim: true, default: "7.85" },
        grade: { type: String, trim: true },
        make: { type: String, trim: true },
        remarks: { type: String, trim: true },
        hardness: { type: [bomHardnessSchema], default: [] },
    },
    { _id: true }
);

export const itemSchema: Schema<Items> = new Schema(
    {
        itemCode: {
            type: String,
            required: [true, "Item code is required"],
            trim: true,
            unique: true,
            index: true,
        },
        itemName: {
            type: String,
            trim: true,
            required: [true, "Item name is required"],
        },
        itemDesc: {
            type: String,
            trim: true,
            required: [true, "Item description is required"],
        },
        itemType: {
            type: String,
            enum: ["SET", "ASSEMBLY", "UNIT"],
            required: [true, "Item type is required"],
        },
        size: {
            type: String,
            trim: true,
        },
        bom: {
            type: [bomEntrySchema],
            default: [],
        },
        drawingNumber: { type: String, trim: true },
        uom: { type: String, trim: true },
        hsnCode: { type: String, trim: true },
        ut: { type: String, trim: true },
        moc: { type: String, trim: true },
        testing: { type: String, trim: true },
        hardness: {
            type: [bomHardnessSchema],
            default: [],
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
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

export const Item = mongoose.model<Items>("Item", itemSchema);
