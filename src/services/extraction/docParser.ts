import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import fs from "fs";
import path from "path";

export interface ParsedRfpData {
    prNumber: string;
    supplyType: string;
    location: string;
    companyName: string;
    items: ParsedItem[];
    rawText: string;
}

export interface ParsedItem {
    serialNumber: string;
    itemCode: string;
    itemName: string;
    itemDesc: string;
    itemType: "SET" | "ASSEMBLY" | "UNIT";
    uom: string;
    quantity: number;
    drawingNumber: string;
    technical: {
        material: string;
        hardness: string;
        surfaceFinish: string;
        heatTreatment: string;
        diameter: string;
        length: string;
        weight: string;
        grade: string;
    };
}

// Extract raw text from .doc/.docx files using mammoth
async function extractTextFromDoc(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

// Extract raw text from PDF files using pdf-parse
async function extractTextFromPdf(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text;
}

// Extract text from file based on extension
export async function extractTextFromFile(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".doc" || ext === ".docx") {
        return extractTextFromDoc(filePath);
    } else if (ext === ".pdf") {
        return extractTextFromPdf(filePath);
    }
    throw new Error(`Unsupported file type: ${ext}`);
}

// Parse the RFP filename for metadata
// Pattern: RFP - {PR_NUMBER(10digit)}-{SECOND_NUMBER(10digit)}-{SupplyType}-{LOCATION}-{ITEM_DESC}.doc
// e.g. RFP - 1600630211-3100877992-Revenue Supply-VIJAYANAGAR-BLT,MACHINE BOLT,...
// prNumber = 1600630211 (10-digit, starts with 1600)
// Item code is NOT from the filename — it's an 18-digit number inside the document
// e.g. 000000002100112312 → extract "2100112312" (10 digits starting from 2100)
function parseFilename(filename: string): {
    prNumber: string;
    supplyType: string;
    location: string;
    itemDesc: string;
} {
    const result = { prNumber: "", supplyType: "", location: "", itemDesc: "" };

    // Remove extension
    const nameWithoutExt = filename.replace(/\.(doc|docx|pdf)$/i, "");

    // Try to parse the known pattern: RFP - {10digit}-{10digit}-SupplyType-LOCATION-ITEM_DESC
    const rfpMatch = nameWithoutExt.match(
        /^RFP\s*-\s*(\d{10})-(\d{10})-(.+?)-([A-Z]+)-(.+)$/i
    );

    if (rfpMatch) {
        result.prNumber = rfpMatch[1] ?? "";
        // rfpMatch[2] is the second 10-digit number — NOT the item code
        result.supplyType = rfpMatch[3]?.trim() ?? "";
        result.location = rfpMatch[4]?.trim() ?? "";
        result.itemDesc = rfpMatch[5]?.trim() ?? "";
    }

    return result;
}

// Parse structured data from raw text using regex patterns
function parseRfpText(rawText: string, filename: string): ParsedRfpData {
    const filenameMeta = parseFilename(filename);

    const data: ParsedRfpData = {
        prNumber: filenameMeta.prNumber,
        supplyType: filenameMeta.supplyType,
        location: filenameMeta.location,
        companyName: "",
        items: [],
        rawText,
    };

    // Try to extract PR number from text if not from filename
    if (!data.prNumber) {
        const prMatch = rawText.match(/(?:PR|PO|RFP|RFQ)\s*(?:No|Number|#)?[:\s]*(\d[\d\-\/]+)/i);
        if (prMatch) {
            data.prNumber = prMatch[1]?.trim() ?? "";
        }
    }

    // Extract company name
    const companyMatch = rawText.match(
        /(?:Company|Vendor|Supplier|Party|Firm)\s*(?:Name)?[:\s]*([^\n\r]+)/i
    );
    if (companyMatch) {
        data.companyName = companyMatch[1]?.trim() ?? "";
    }

    // Extract location if not from filename
    if (!data.location) {
        const locationMatch = rawText.match(
            /(?:Location|Plant|Site|Delivery\s*(?:to|at|point))[:\s]*([^\n\r]+)/i
        );
        if (locationMatch) {
            data.location = locationMatch[1]?.trim() ?? "";
        }
    }

    // Extract item details from text
    const items = extractItemsFromText(rawText, filenameMeta.itemDesc);
    data.items = items;

    return data;
}

// Extract items from RFP text content
function extractItemsFromText(rawText: string, filenameItemDesc: string): ParsedItem[] {
    const items: ParsedItem[] = [];

    // Extract item codes: 18-digit numbers like 000000002100112312 → take "2100112312"
    const itemCodes = extract2100ItemCodes(rawText);

    // Extract serial numbers (e.g. "7.3", "7.4") that appear near item entries
    const serialNumbers = extractSerialNumbers(rawText, itemCodes);

    const quantityPattern = /(?:Qty|Quantity|Nos|Numbers?)[:\s]*(\d+(?:\.\d+)?)/gi;
    const uomPattern = /(?:UOM|Unit)[:\s]*([A-Za-z]+)/gi;
    const materialPattern = /(?:MOC|Material|Material\s*of\s*Construction)[:\s]*([^\n\r,]+)/gi;
    const drawingPattern = /(?:Drawing|Drg|DWG)\s*(?:No|Number)?[:\s]*([^\n\r,]+)/gi;
    const hardnessPattern = /(?:Hardness)[:\s]*([^\n\r,]+)/gi;
    const surfacePattern = /(?:Surface\s*Finish)[:\s]*([^\n\r,]+)/gi;
    const heatPattern = /(?:Heat\s*Treatment)[:\s]*([^\n\r,]+)/gi;

    // Collect all matches
    const quantities = getAllMatches(rawText, quantityPattern);
    const uoms = getAllMatches(rawText, uomPattern);
    const materials = getAllMatches(rawText, materialPattern);
    const drawings = getAllMatches(rawText, drawingPattern);
    const hardnesses = getAllMatches(rawText, hardnessPattern);
    const surfaces = getAllMatches(rawText, surfacePattern);
    const heatTreatments = getAllMatches(rawText, heatPattern);

    // If we found item codes, create items for each
    if (itemCodes.length > 0) {
        for (let i = 0; i < itemCodes.length; i++) {
            items.push(buildParsedItem({
                serialNumber: serialNumbers[i] ?? "",
                itemCode: itemCodes[i] ?? "",
                quantity: quantities[i] ? parseFloat(quantities[i] ?? "0") : 0,
                uom: uoms[i] ?? "",
                material: materials[i] ?? "",
                drawingNumber: drawings[i] ?? "",
                hardness: hardnesses[i] ?? "",
                surfaceFinish: surfaces[i] ?? "",
                heatTreatment: heatTreatments[i] ?? "",
                itemDesc: i === 0 ? filenameItemDesc : "",
            }));
        }
    } else if (filenameItemDesc) {
        // No 2100 item codes found — build item from filename description
        items.push(buildParsedItem({
            serialNumber: serialNumbers[0] ?? "",
            itemCode: generateItemCodeFromDesc(filenameItemDesc),
            quantity: quantities[0] ? parseFloat(quantities[0] ?? "0") : 0,
            uom: uoms[0] ?? "",
            material: materials[0] ?? "",
            drawingNumber: drawings[0] ?? "",
            hardness: hardnesses[0] ?? "",
            surfaceFinish: surfaces[0] ?? "",
            heatTreatment: heatTreatments[0] ?? "",
            itemDesc: filenameItemDesc,
        }));
    }

    return items;
}

function buildParsedItem(data: {
    serialNumber: string;
    itemCode: string;
    quantity: number;
    uom: string;
    material: string;
    drawingNumber: string;
    hardness: string;
    surfaceFinish: string;
    heatTreatment: string;
    itemDesc: string;
}): ParsedItem {
    return {
        serialNumber: data.serialNumber,
        itemCode: data.itemCode,
        itemName: data.itemDesc.replace(/,/g, " ").trim(),
        itemDesc: data.itemDesc,
        itemType: "UNIT",
        uom: data.uom,
        quantity: data.quantity,
        drawingNumber: data.drawingNumber,
        technical: {
            material: data.material,
            hardness: data.hardness,
            surfaceFinish: data.surfaceFinish,
            heatTreatment: data.heatTreatment,
            diameter: "",
            length: "",
            weight: "",
            grade: "",
        },
    };
}

// Extract serial numbers like "7.3", "7.4" that appear near item codes in the document
// These are typically section/subsection numbers preceding each line item
function extractSerialNumbers(rawText: string, itemCodes: string[]): string[] {
    const serials: string[] = [];

    // Strategy 1: Find serial numbers near each item code in the text
    for (const code of itemCodes) {
        const codeIdx = rawText.indexOf(code);
        if (codeIdx === -1) {
            // Try finding the 18-digit version
            const searchWindow = rawText;
            const eighteenDigitPattern = new RegExp(`\\d*${code}\\d*`, "g");
            const match = eighteenDigitPattern.exec(searchWindow);
            if (match) {
                const beforeText = rawText.substring(Math.max(0, match.index - 200), match.index);
                const serialMatch = beforeText.match(/(\d+\.\d+(?:\.\d+)?)\s*$/);
                if (serialMatch) {
                    serials.push(serialMatch[1] ?? "");
                    continue;
                }
            }
            serials.push("");
            continue;
        }

        // Look in the 200 chars before the item code for a serial number pattern
        const beforeText = rawText.substring(Math.max(0, codeIdx - 200), codeIdx);
        // Match patterns like "7.3", "7.4", "7.3.1" — the last one closest to the item code
        const serialMatch = beforeText.match(/(\d+\.\d+(?:\.\d+)?)\s*$/);
        if (serialMatch) {
            serials.push(serialMatch[1] ?? "");
        } else {
            // Try broader search — find any "X.Y" pattern in the preceding text
            const allSerials = [...beforeText.matchAll(/\b(\d+\.\d+(?:\.\d+)?)\b/g)];
            if (allSerials.length > 0) {
                serials.push(allSerials[allSerials.length - 1]?.[1] ?? "");
            } else {
                serials.push("");
            }
        }
    }

    return serials;
}

// Extract item codes from 18-digit numbers containing "2100"
// e.g. "000000002100112312" → "2100112312" (10 digits starting from 2100)
function extract2100ItemCodes(text: string): string[] {
    const codes: string[] = [];
    const seen = new Set<string>();

    // Match 18-digit numbers that contain 2100
    const eighteenDigitPattern = /\b(\d{18})\b/g;
    let match: RegExpExecArray | null;
    while ((match = eighteenDigitPattern.exec(text)) !== null) {
        const fullNumber = match[1] ?? "";
        const idx2100 = fullNumber.indexOf("2100");
        if (idx2100 !== -1) {
            const code = fullNumber.substring(idx2100, idx2100 + 10);
            if (code.length === 10 && !seen.has(code)) {
                seen.add(code);
                codes.push(code);
            }
        }
    }

    // Also try standalone 10-digit numbers starting with 2100
    if (codes.length === 0) {
        const tenDigitPattern = /\b(2100\d{6})\b/g;
        while ((match = tenDigitPattern.exec(text)) !== null) {
            const code = match[1] ?? "";
            if (!seen.has(code)) {
                seen.add(code);
                codes.push(code);
            }
        }
    }

    return codes;
}

// Generate an item code from item description
function generateItemCodeFromDesc(desc: string): string {
    return desc
        .replace(/[^A-Za-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toUpperCase()
        .substring(0, 30);
}

// Get all regex matches from text
function getAllMatches(text: string, pattern: RegExp): string[] {
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        if (match[1]) {
            matches.push(match[1].trim());
        }
    }
    return matches;
}

// Main parser function — Layer 2
export async function parseRfpDocument(
    filePath: string,
    originalFilename: string
): Promise<{ success: boolean; data: ParsedRfpData; isPartial: boolean }> {
    const rawText = await extractTextFromFile(filePath);

    if (!rawText || rawText.trim().length === 0) {
        return {
            success: false,
            data: {
                prNumber: "",
                supplyType: "",
                location: "",
                companyName: "",
                items: [],
                rawText: "",
            },
            isPartial: false,
        };
    }

    const parsed = parseRfpText(rawText, originalFilename);

    // Determine if extraction is complete or partial
    const hasItems = parsed.items.length > 0;
    const hasPrNumber = parsed.prNumber.length > 0;
    const hasLocation = parsed.location.length > 0;
    const itemsComplete = parsed.items.every(
        item => item.itemCode && item.quantity > 0
    );

    const isComplete = hasItems && hasPrNumber && hasLocation && itemsComplete;
    const isPartial = hasItems || hasPrNumber || hasLocation;

    return {
        success: isComplete || isPartial,
        data: parsed,
        isPartial: !isComplete && isPartial,
    };
}
