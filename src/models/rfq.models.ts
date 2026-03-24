import mongoose, { Schema } from "mongoose";
import { RFQItems } from "./rfqItems.model";

export interface IRfq {
    prNumber: string;
    startDate: Date;
    dueDate: Date;
    ownerName: string;
    companyName: string;
    location: string;
    isQuoted: boolean;
    quotedOn?: Date;
    quotationNumber?: number;
    isRevised: boolean;
    revisionDate?: Date;
    isRegret: boolean;
    regretDate?: Date;
    status: "PENDING_SELECTION" | "AWARDED" | "COMPLETED" | "PREVIEW" | "ACCEPTING_RESPONSE";
    deliveryWeeks: number;
    items: RFQItems[];
    isDeleted: boolean;
    createdBy: string;
    updatedBy: string;
}

export const rfqSchema: Schema<IRfq> = new Schema(
    {
        prNumber: {
            type: String,
            required: [true, "PR number is required !"],
            trim: true,
        },
        startDate: {
            type: Date,
            required: [true, "PR start date is required !"],
            default: new Date(),
        },
        dueDate: {
            type: Date,
            required: [true, "Due Date is required !"],
            default: new Date(),
        },
        ownerName: {
            type: String,
            trim: true,
        },
        companyName: {
            type: String,
            trim: true,
            required: [true, "Company name is required !"],
        },
        location: {
            type: String,
            trim: true,
            required: [true, "Location is required !"],
        },
        isQuoted: {
            type: Boolean,
            default: false,
        },
        quotedOn: {
            type: Date,
            required: function (this: IRfq) {
                return this.isQuoted === true;
            },
            validate: {
                validator: function (this: IRfq, value: Date) {
                    if (this.isQuoted && !value) {
                        return false;
                    }
                    return true;
                },
                message: "Quoted date is required when PR is quoted",
            },
        },
        quotationNumber: {
            type: Number,
            unique: true,
            sparse: true,
        },
        isRevised: {
            type: Boolean,
            default: false,
        },
        revisionDate: {
            type: Date,
        },
        isRegret: {
            type: Boolean,
            default: false,
        },
        regretDate: {
            type: Date,
        },
        status: {
            type: String,
            enum: ["PENDING_SELECTION", "AWARDED", "COMPLETED", "PREVIEW", "ACCEPTING_RESPONSE"],
            required: [true, "Status is required"],
            default: "ACCEPTING_RESPONSE",
        },
        deliveryWeeks: {
            type: Number,
            min: 1,
            max: 52,
        },
        items: [{
            type: Schema.Types.ObjectId,
            ref: "RFQItems",
            required: true,
        }],
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

// Unique PR number only among non-deleted RFQs (allows re-adding after soft delete)
rfqSchema.index({ prNumber: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const RFQ = mongoose.model<IRfq>("RFQ", rfqSchema);
