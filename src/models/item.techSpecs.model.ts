import mongoose, { Schema } from "mongoose";

export interface IHardness {
    hardnessType: string;
    value: string;
    measurement: string;
}

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
    remarks?: string;
    hardness?: IHardness[];
}

const hardnessSchema = new Schema<IHardness>(
    {
        hardnessType: {
            type: String,
            trim: true,
        },
        value: {
            type: String,
            trim: true,
        },
        measurement: {
            type: String,
            trim: true,
        },
    },
    { _id: true }
);

export const itemTechSpecsSchema: Schema<ItemTechSpecs> = new Schema(
    {
        material: {
            type: String,
            trim: true,
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
        remarks: {
            type: String,
            trim: true,
        },
        hardness: {
            type: [hardnessSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

export const ItemTechSpecs = mongoose.model<ItemTechSpecs>("ItemTechSpecs", itemTechSpecsSchema);