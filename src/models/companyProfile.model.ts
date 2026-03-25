import mongoose, { Schema } from "mongoose";

export interface ICompanyProfile {
    name: string;
    tagline?: string;
    gstin?: string;
    vendorCode?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
    phone?: string;
    email?: string;
    contactPersonName?: string;
    contactPersonEmail?: string;
    logoUrl?: string;
}

const companyProfileSchema = new Schema<ICompanyProfile>(
    {
        name: { type: String, required: true, trim: true },
        tagline: { type: String, trim: true, default: "" },
        gstin: { type: String, trim: true, default: "" },
        vendorCode: { type: String, trim: true, default: "" },
        addressLine1: { type: String, trim: true, default: "" },
        addressLine2: { type: String, trim: true, default: "" },
        city: { type: String, trim: true, default: "" },
        state: { type: String, trim: true, default: "" },
        pincode: { type: String, trim: true, default: "" },
        country: { type: String, trim: true, default: "India" },
        phone: { type: String, trim: true, default: "" },
        email: { type: String, trim: true, default: "" },
        contactPersonName: { type: String, trim: true, default: "" },
        contactPersonEmail: { type: String, trim: true, default: "" },
        logoUrl: { type: String, trim: true, default: "" },
    },
    { timestamps: true }
);

export const CompanyProfile = mongoose.model<ICompanyProfile>(
    "CompanyProfile",
    companyProfileSchema
);
