import mongoose, { Schema } from "mongoose";

export interface IParty {
    acName?: string;
    cpName?: string;
    mobile?: string;
    phone?: string;
    email?: string;
    add1?: string;
    add2?: string;
    add3?: string;
    pin?: string;
    cin?: string;
    vat?: string;
    cst?: string;
    pan?: string;
    tan?: string;
    range?: string;
    tin?: string;
    ecc?: string;
    stregn?: string;
    state?: string;
    statecd?: string;
    gstin?: string;
    partyType: "RAW_MATERIAL_DEALER" | "LABOUR_JOB_WORKER" | "COMPLETE_SUPPLY";
    partySubType?: mongoose.Types.ObjectId;
    isDeleted?: boolean;
}

export const partySchema: Schema<IParty> = new Schema(
    {
        acName: {
            type: String,
            trim: true,
        },
        cpName: {
            type: String,
            trim: true,
        },
        mobile: {
            type: String,
            trim: true,
        },
        phone: {
            type: String,
            trim: true,
        },
        email: {
            type: String,
            trim: true,
        },
        add1: {
            type: String,
            trim: true,
        },
        add2: {
            type: String,
            trim: true,
        },
        add3: {
            type: String,
            trim: true,
        },
        pin: {
            type: String,
            trim: true,
        },
        cin: {
            type: String,
            trim: true,
        },
        vat: {
            type: String,
            trim: true,
        },
        cst: {
            type: String,
            trim: true,
        },
        pan: {
            type: String,
            trim: true,
        },
        tan: {
            type: String,
            trim: true,
        },
        range: {
            type: String,
            trim: true,
        },
        tin: {
            type: String,
            trim: true,
        },
        ecc: {
            type: String,
            trim: true,
        },
        stregn: {
            type: String,
            trim: true,
        },
        state: {
            type: String,
            trim: true,
        },
        statecd: {
            type: String,
            trim: true,
        },
        gstin: {
            type: String,
            trim: true,
        },
        partyType: {
            type: String,
            required: [true, "Party type is required"],
            enum: ["RAW_MATERIAL_DEALER", "LABOUR_JOB_WORKER", "COMPLETE_SUPPLY"],
            index: true,
        },
        partySubType: {
            type: Schema.Types.ObjectId,
            required: [
                function (this: IParty) {
                    return this.partyType !== "COMPLETE_SUPPLY";
                },
                "Party sub type is required for RAW_MATERIAL_DEALER and LABOUR_JOB_WORKER",
            ],
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

export const Party = mongoose.model<IParty>("Party", partySchema);
