import mongoose, { Schema } from "mongoose";
import { ItemTechSpecs } from "./item.techSpecs.model";

export interface Items {
    itemCode: string;
    itemName: string;
    itemDesc: string;
    drawingNumber: string;
    drawingUrl?: string;
    itemType: "SET" | "ASSEMBLY" | "UNIT";
    size: string;
    itemTechSpecs: ItemTechSpecs;
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
        drawingNumber: {
            type: String,
            trim: true,
            required: [true, "Drawing number is required"],
        },
        drawingUrl: {
            type: String,
            trim: true,
        },
        itemType: {
            type: String,
            enum: ["SET", "ASSEMBLY", "UNIT"],
            required: [true, "Item type is required"],
        },
        size: {
            type: String,
            trim: true,
            required: [true, "Size is required"],
        },
        itemTechSpecs: {
            type: Schema.Types.ObjectId,
            ref: "ItemTechSpecs",
            required: [true, "Item tech specs is required"],
        },
    },
    {
        timestamps: true,
    }
);

export const Item = mongoose.model<Items>("Item", itemSchema);
