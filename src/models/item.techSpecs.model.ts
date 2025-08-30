import mongoose, { Schema } from "mongoose";

export interface ItemTechSpecs {
    material: string;
    diameter?: string;
    length?: string;
    weight?: string;
    bore?: string;
    thickness?: string;
    type?: string;
    threadLength?: string;
    threadType?: string;
    threadPitch?: string;
    grade?: string;
}

export const itemTechSpecsSchema: Schema<ItemTechSpecs> = new Schema(
    {
        material: {
            type: String,
            trim: true,
            required: [true, "Material is required"],
        },
        diameter: {
            type: String,
            trim: true,
        },
        length: {
            type: String,
            trim: true,
        },
        weight: {
            type: String,
            trim: true,
        },
        bore: {
            type: String,
            trim: true,
        },
        thickness: {
            type: String,
            trim: true,
        },
        type: {
            type: String,
            trim: true,
        },
        threadLength: {
            type: String,
            trim: true,
        },
        threadType: {
            type: String,
            trim: true,
        },
        threadPitch: {
            type: String,
            trim: true,
        },
        grade: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

export const ItemTechSpecs = mongoose.model<ItemTechSpecs>("ItemTechSpecs", itemTechSpecsSchema);