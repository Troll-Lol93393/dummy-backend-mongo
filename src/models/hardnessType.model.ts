import mongoose, { Schema } from "mongoose";

export interface IHardnessType {
    name: string;
    description?: string;
    isDeleted?: boolean;
}

export const hardnessTypeSchema: Schema<IHardnessType> = new Schema(
    {
        name: {
            type: String,
            required: [true, "Hardness type name is required"],
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

export const HardnessType = mongoose.model<IHardnessType>("HardnessType", hardnessTypeSchema);
