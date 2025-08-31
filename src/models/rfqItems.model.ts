import mongoose, { Schema } from "mongoose";
import { CommercialSpecs } from "./item.commercial.model";
import { ItemTechSpecs } from "./item.techSpecs.model";
import { Items } from "./item.model";

export interface RFQItems {
    item: Items;
    quantity: number;
    drawingNumber: string;
    drawingUrl?: string;
    itemTechSpecs: ItemTechSpecs;
    commercialSpecs: CommercialSpecs;
}

export const rfqItemsSchema: Schema<RFQItems> = new Schema(
    {
        item: {
            type: Schema.Types.ObjectId,
            ref: "Item",
            required: [true, "Item is required"],
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
        quantity: {
            type: Number,
            required: [true, "Quantity is required"],
            min: 1,
        },
        itemTechSpecs: {
            type: Schema.Types.ObjectId,
            ref: "ItemTechSpecs",
            required: [true, "Item tech specs is required"],
        },
        commercialSpecs: {
            type: Schema.Types.ObjectId,
            ref: "CommercialSpecs",
            required: [true, "Commercial specs is required"],
        },
    },
    {
        timestamps: true,
    }
);

export const RFQItems = mongoose.model<RFQItems>("RFQItems", rfqItemsSchema);