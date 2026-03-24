import mongoose, { Schema } from "mongoose";

export interface IHardnessMeasurement {
    name: string;
    description?: string;
    isDeleted?: boolean;
}

export const hardnessMeasurementSchema: Schema<IHardnessMeasurement> = new Schema(
    {
        name: {
            type: String,
            required: [true, "Hardness measurement name is required"],
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

export const HardnessMeasurement = mongoose.model<IHardnessMeasurement>(
    "HardnessMeasurement",
    hardnessMeasurementSchema
);
