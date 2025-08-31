import mongoose, { Schema } from "mongoose";

export interface Items {
    itemCode: string;
    itemName: string;
    itemDesc: string;
    itemType: "SET" | "ASSEMBLY" | "UNIT";
    size?: string;
    isDeleted?: boolean;
    deletedAt?: Date;
}

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
