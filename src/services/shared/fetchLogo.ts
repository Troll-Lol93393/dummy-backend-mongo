import { CompanyInfo } from "./companyInfo";

/**
 * Fetches the company logo as a Buffer from the logoUrl.
 * Returns null if no logoUrl or fetch fails.
 */
export async function fetchLogoBuffer(company: CompanyInfo): Promise<Buffer | null> {
    if (!company.logoUrl) return null;
    try {
        const response = await fetch(company.logoUrl);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch {
        return null;
    }
}
