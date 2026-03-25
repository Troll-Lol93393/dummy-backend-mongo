export interface CompanyInfo {
    name: string;
    tagline?: string;
    gstin?: string;
    vendorCode?: string;
    /** Pre-formatted single-line address for templates */
    address?: string;
    phone?: string;
    email?: string;
    contactPersonName?: string;
    contactPersonPhone?: string;
    contactPersonEmail?: string;
    logoUrl?: string;
}

/** Fallback values when no CompanyProfile exists in DB */
export const DEFAULT_COMPANY: CompanyInfo = {
    name: "SHETH ENGINEERING",
    tagline: "Precision Engineering & Manufacturing Solutions",
    gstin: "24AABCS1234F1ZP",
    vendorCode: "SE-2024-001",
    address: "Plot No. 123, Industrial Area, Phase-II, Ahmedabad, Gujarat — 382 445",
    phone: "+91 79 2583 XXXX",
};
