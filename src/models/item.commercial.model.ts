import mongoose, { Schema } from "mongoose";

export interface CommercialSpecs {
    currency: string;
    rawMaterialCost: number;
    laborCost: number;
    profitMargin: number;
    totalCost: number;
    packingCost: number;
    shippingCost: number;
    sellingPrice: number;
    otherCosts: number;
}

export const commercialSpecsSchema: Schema<CommercialSpecs> = new Schema(
    {
        currency: {
            type: String,
            trim: true,
            required: [true, "Currency is required"],
        },
        rawMaterialCost: {
            type: Number,
            min: 1,
            required: [true, "Raw material cost is required"],
        },
        laborCost: {
            type: Number,
            min: 1,
            required: [true, "Labor cost is required"],
        },
        profitMargin: {
            type: Number,
            min: 1,
            required: [true, "Profit margin is required"],
        },
        totalCost: {
            type: Number,
            min: 1,
            required: [true, "Total cost is required"],
        },
        packingCost: {
            type: Number,
            min: 1,
            required: [true, "Packing cost is required"],
        },
        shippingCost: {
            type: Number,
            min: 1,
            required: [true, "Shipping cost is required"],
        },
        sellingPrice: {
            type: Number,
            min: 1,
            required: [true, "Selling price is required"],
        },
        otherCosts: {
            type: Number,
            min: 1,
            required: [true, "Other costs are required"],
        },
    },
    {
        timestamps: true,
    }
)