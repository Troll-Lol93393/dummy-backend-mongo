import mongoose, { Schema } from "mongoose";

export interface ILabourProcessType {
    name: string;
    description?: string;
    isDeleted?: boolean;
}

export const labourProcessTypeSchema: Schema<ILabourProcessType> = new Schema(
    {
        name: {
            type: String,
            required: [true, "Labour process type name is required"],
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

export const LabourProcessType = mongoose.model<ILabourProcessType>(
    "LabourProcessType",
    labourProcessTypeSchema
);
