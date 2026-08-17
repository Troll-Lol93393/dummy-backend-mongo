import mongoose, { Schema } from "mongoose";
import { extractCorePoNumber } from "../utils/poNumber";

export interface IPOLineItem {
    serialNumber: number;
    itemCode: string;
    itemDescription: string;
    drawingNumber: string;
    quantity: number;
    rate: number;
    basicValue: number;
    igst: number;
    roundOff: number;
    netAmount: number;
}

export interface IPORegister {
    poNumber: string;
    // Bare 10-digit PO number extracted from poNumber (which is often stored
    // with a job-number prefix, e.g. "VJNR/.../4100189516"). This is what
    // Sales rows and customer emails actually reference — always match
    // against this field, never against poNumber directly.
    corePoNumber: string;
    jobNumber: string;
    poDate: Date;
    deliveryDate?: Date;
    prNumber?: string;
    companyName: string;
    client?: mongoose.Types.ObjectId;
    items: IPOLineItem[];
    totalBasicValue: number;
    totalTax: number;
    totalRoundOff: number;
    totalNetAmount: number;
    isDeleted: boolean;
}

const poLineItemSchema: Schema<IPOLineItem> = new Schema(
    {
        serialNumber: {
            type: Number,
            required: true,
        },
        itemCode: {
            type: String,
            trim: true,
            default: "",
        },
        itemDescription: {
            type: String,
            trim: true,
            default: "",
        },
        drawingNumber: {
            type: String,
            trim: true,
            default: "",
        },
        quantity: {
            type: Number,
            default: 0,
        },
        rate: {
            type: Number,
            default: 0,
        },
        basicValue: {
            type: Number,
            default: 0,
        },
        igst: {
            type: Number,
            default: 0,
        },
        roundOff: {
            type: Number,
            default: 0,
        },
        netAmount: {
            type: Number,
            default: 0,
        },
    },
    { _id: true }
);

const poRegisterSchema: Schema<IPORegister> = new Schema(
    {
        poNumber: {
            type: String,
            required: [true, "PO number is required"],
            unique: true,
            trim: true,
            index: true,
        },
        corePoNumber: {
            type: String,
            trim: true,
            index: true,
        },
        jobNumber: {
            type: String,
            required: [true, "Job number is required"],
            unique: true,
            trim: true,
            index: true,
        },
        poDate: {
            type: Date,
        },
        deliveryDate: {
            type: Date,
        },
        prNumber: {
            type: String,
            trim: true,
        },
        companyName: {
            type: String,
            trim: true,
            default: "",
            index: true,
        },
        client: {
            type: Schema.Types.ObjectId,
            ref: "Client",
        },
        items: [poLineItemSchema],
        totalBasicValue: {
            type: Number,
            default: 0,
        },
        totalTax: {
            type: Number,
            default: 0,
        },
        totalRoundOff: {
            type: Number,
            default: 0,
        },
        totalNetAmount: {
            type: Number,
            default: 0,
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

// Defense-in-depth: covers any future single-document create/save path.
// The bulk import path (bulkWrite) bypasses Mongoose middleware entirely,
// so it must set corePoNumber explicitly itself — see poRegister.controller.ts.
poRegisterSchema.pre("save", function (next) {
    this.corePoNumber = extractCorePoNumber(this.poNumber);
    next();
});

export const PORegister = mongoose.model<IPORegister>("PORegister", poRegisterSchema);
