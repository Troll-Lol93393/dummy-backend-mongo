import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { CompanyProfile, ICompanyProfile } from "../models/companyProfile.model";
import { CompanyInfo } from "../services/shared/companyInfo";
import { uploadFileToCloudinary } from "../utils/cloudinary";
import fs from "fs";

// ── Build formatted address from structured fields ──
function buildFullAddress(p: ICompanyProfile): string {
    const parts: string[] = [];
    if (p.addressLine1) parts.push(p.addressLine1);
    if (p.addressLine2) parts.push(p.addressLine2);

    const cityState: string[] = [];
    if (p.city) cityState.push(p.city);
    if (p.state) cityState.push(p.state);
    if (cityState.length > 0) parts.push(cityState.join(", "));

    if (p.pincode) parts.push(`— ${p.pincode}`);
    if (p.country && p.country !== "India") parts.push(p.country);

    return parts.join(", ");
}

// ── GET  /api/v1/company-profile ──
export const getCompanyProfile = asyncHandler(
    async (_req: Request, res: Response, _next: NextFunction) => {
        let profile = await CompanyProfile.findOne().lean();

        if (!profile) {
            profile = await CompanyProfile.create({
                name: "SHETH ENGINEERING",
                tagline: "Precision Engineering & Manufacturing Solutions",
                gstin: "24AABCS1234F1ZP",
                vendorCode: "SE-2024-001",
                addressLine1: "Plot No. 123, Industrial Area, Phase-II",
                city: "Ahmedabad",
                state: "Gujarat",
                pincode: "382445",
                country: "India",
                phone: "+91 79 2583 XXXX",
            });
        }

        res.status(200).json(new ApiResponse(200, profile, "Company profile fetched"));
    }
);

// ── PUT  /api/v1/company-profile ──
export const updateCompanyProfile = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const {
            name,
            tagline,
            gstin,
            vendorCode,
            addressLine1,
            addressLine2,
            city,
            state,
            pincode,
            country,
            phone,
            email,
            contactPersonName,
            contactPersonEmail,
        } = req.body;

        if (!name || !name.trim()) {
            throw new ApiError(400, "Company name is required");
        }

        let profile = await CompanyProfile.findOne();
        if (!profile) {
            profile = new CompanyProfile();
        }

        profile.name = name.trim();
        if (tagline !== undefined) profile.tagline = tagline.trim();
        if (gstin !== undefined) profile.gstin = gstin.trim();
        if (vendorCode !== undefined) profile.vendorCode = vendorCode.trim();
        if (addressLine1 !== undefined) profile.addressLine1 = addressLine1.trim();
        if (addressLine2 !== undefined) profile.addressLine2 = addressLine2.trim();
        if (city !== undefined) profile.city = city.trim();
        if (state !== undefined) profile.state = state.trim();
        if (pincode !== undefined) profile.pincode = pincode.trim();
        if (country !== undefined) profile.country = country.trim();
        if (phone !== undefined) profile.phone = phone.trim();
        if (email !== undefined) profile.email = email.trim();
        if (contactPersonName !== undefined) profile.contactPersonName = contactPersonName.trim();
        if (contactPersonEmail !== undefined)
            profile.contactPersonEmail = contactPersonEmail.trim();

        await profile.save();

        res.status(200).json(new ApiResponse(200, profile, "Company profile updated"));
    }
);

// ── POST  /api/v1/company-profile/logo  (multipart file upload) ──
export const uploadCompanyLogo = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const file = req.file;
        if (!file) {
            throw new ApiError(400, "Logo file is required");
        }

        const result = await uploadFileToCloudinary(file.path);

        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }

        if (!result) {
            throw new ApiError(500, "Failed to upload logo to Cloudinary");
        }

        let profile = await CompanyProfile.findOne();
        if (!profile) {
            profile = new CompanyProfile({ name: "SHETH ENGINEERING" });
        }

        profile.logoUrl = result.secure_url;
        await profile.save();

        res.status(200).json(new ApiResponse(200, profile, "Logo uploaded successfully"));
    }
);

// ── Helper: fetch profile for generators (returns CompanyInfo with formatted address) ──
export async function getCompanyProfileForGenerators(): Promise<CompanyInfo> {
    const profile = await CompanyProfile.findOne().lean();
    if (profile) {
        return {
            name: profile.name,
            tagline: profile.tagline,
            gstin: profile.gstin,
            vendorCode: profile.vendorCode,
            address: buildFullAddress(profile),
            phone: profile.phone,
            email: profile.email,
            contactPersonName: profile.contactPersonName,
            contactPersonEmail: profile.contactPersonEmail,
            logoUrl: profile.logoUrl,
        };
    }

    // Fallback defaults
    return {
        name: "SHETH ENGINEERING",
        tagline: "Precision Engineering & Manufacturing Solutions",
        gstin: "24AABCS1234F1ZP",
        vendorCode: "SE-2024-001",
        address: "Plot No. 123, Industrial Area, Phase-II, Ahmedabad, Gujarat — 382 445",
        phone: "+91 79 2583 XXXX",
    };
}
