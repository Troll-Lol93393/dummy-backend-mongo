import mongoose, { Schema } from "mongoose";
import { CommercialSpecs } from "./item.commercial.model";
import { ItemTechSpecs } from "./item.techSpecs.model";
import { Items } from "./item.model";

export interface RFQItems {
    serialNumber: string;
    item: Items;
    quantity: number;
    drawingNumber: string;
    drawingUrl?: string;
    itemTechSpecs: ItemTechSpecs;
    commercialSpecs: CommercialSpecs;
    isDeleted: boolean;
}   

export const RfqItemsSchema: Schema<RFQItems> = new Schema(
    {
        serialNumber: {
            type: String,
            trim: true,
            default: "",
        },
        item: {
            type: Schema.Types.ObjectId,
            ref: "Item",
            required: [true, "Item is required"],
        },
        drawingNumber: {
            type: String,
            trim: true,
        },
        drawingUrl: {
            type: String,
            trim: true,
        },
        quantity: {
            type: Number,
            required: [true, "Quantity is required"],
            min: 1,
        },
        itemTechSpecs: {
            type: Schema.Types.ObjectId,
            ref: "ItemTechSpecs",
        },
        commercialSpecs: {
            type: Schema.Types.ObjectId,
            ref: "CommercialSpecs",
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

export const RFQItems = mongoose.model<RFQItems>("RFQItems", RfqItemsSchema);