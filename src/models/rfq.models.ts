import mongoose, { Schema } from "mongoose";

export interface IRfq {
    number: string;
    startDate: Date;
    dueDate: Date;
    ownerName: string;
    companyName: string;
    location: string;
    isQuoted: boolean;
    quotedOn?: Date;
    status: "PENDING_SELECTION"|"AWARDED"|"COMPLETED"|"PREVIEW"|"ACCEPTING_RESPONSE";
}

export const rfqSchema: Schema<IRfq> = new Schema(
    {
        number: {
            type: String,
            required: [true, "PR number is required !"],
            trim: true,
            unique: true,
            index: true,
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
            required: [true, "Due Date is required !"],
        },
        location: {
            type: String,
            trim: true,
            required: [true, "Due Date is required !"],
        },
        isQuoted: {
            type: Boolean,
            default: false,
        },
        quotedOn: {
            type: Date,
            required: function(this: IRfq) {
                return this.isQuoted === true;
            },
            validate: {
                validator: function(this: IRfq, value: Date) {
                    if (this.isQuoted && !value) {
                        return false;
                    }
                    return true;
                },
                message: 'Quoted date is required when PR is quoted'
            }
        },
        status:{
            type: String,
            enum: ["PENDING_SELECTION", "AWARDED", "COMPLETED", "PREVIEW", "ACCEPTING_RESPONSE"],
            required: [true, "Status is required"],
            default: "ACCEPTING_RESPONSE"
        },
    },
    {
        timestamps: true,
    }
)

export const RFQ = mongoose.model<IRfq>("RFQ",  rfqSchema)