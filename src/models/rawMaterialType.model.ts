import mongoose, { Schema } from "mongoose";

export interface IRawMaterialType {
    name: string;
    description?: string;
    isDeleted?: boolean;
}

export const rawMaterialTypeSchema: Schema<IRawMaterialType> = new Schema(
    {
        name: {
            type: String,
            required: [true, "Raw material type name is required"],
            trim: true,
            unique: true,
        },
        description: {
            type: String,
            trim: true,
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

export const RawMaterialType = mongoose.model<IRawMaterialType>(
    "RawMaterialType",
    rawMaterialTypeSchema
);
