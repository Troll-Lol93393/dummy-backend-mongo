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
        },
        laborCost: {
            type: Number,
        },
        profitMargin: {
            type: Number,
        },
        totalCost: {
            type: Number,
        },
        packingCost: {
            type: Number,
        },
        shippingCost: {
            type: Number,
        },
        sellingPrice: {
            type: Number,
        },
        otherCosts: {
            type: Number,
        },
    },
    {
        timestamps: true,
    }
)

export const CommercialSpecs = mongoose.model<CommercialSpecs>("CommercialSpecs", commercialSpecsSchema);