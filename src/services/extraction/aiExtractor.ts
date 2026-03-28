import axios from "axios";
import { ParsedRfpData, ParsedItem } from "./docParser";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are a data extraction assistant specialized in extracting structured data from RFP (Request for Proposal/Quotation) documents used in industrial procurement.

IMPORTANT RULES:
- The filename follows this pattern: RFP - {PR_NUMBER}-{SECOND_NUMBER}-{SupplyType}-{LOCATION}-{ITEM_DESC}.doc
- PR Number (prNumber) is the FIRST 10-digit number (starts with 1600). e.g. "1600630211"
- The second 10-digit number in the filename is NOT the item code.
- Item codes are 18-digit numbers found INSIDE the document text, like "000000002100112312".
  Extract the 10 digits starting from "2100" — e.g. "2100112312" is the item code.
- If you cannot find an 18-digit item code in the text, look for any 10-digit number starting with "2100".

Return ONLY valid JSON with this exact structure (no markdown, no explanation, no extra text):
{
    "prNumber": "string - the first 10-digit number from filename (e.g. 1600630211)",
    "supplyType": "string - type of supply (Revenue Supply, Capital Supply, etc)",
    "location": "string - plant/delivery location",
    "companyName": "string - vendor/company name",
    "dueDate": "string - the due date / deadline / response end date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss). Look for 'Due date', 'End Date', 'Deadline', or 'Closing Date' fields in the document.",
    "items": [
        {
            "serialNumber": "string - the section/serial number from the document (e.g. '7.3', '7.4', '7.3.1'). Look for dot-notation numbers that label each line item in the document",
            "itemCode": "string - 10-digit code starting with 2100 extracted from the 18-digit number in the document",
            "itemName": "string - short item name",
            "itemDesc": "string - full item description",
            "itemType": "UNIT or SET or ASSEMBLY",
            "uom": "string - unit of measure (EA, KG, MTR, NOS, SET, etc)",
            "quantity": number,
            "drawingNumber": "string - drawing/DRG number if mentioned",
            "technical": {
                "material": "string - MOC/material of construction",
                "hardness": "string - hardness specification",
                "surfaceFinish": "string - surface finish requirement",
                "heatTreatment": "string - heat treatment requirement",
                "diameter": "string - diameter if mentioned",
                "length": "string - length if mentioned",
                "weight": "string - weight if mentioned",
                "grade": "string - material grade"
            }
        }
    ]
}

If a field is not found in the document, use empty string for strings and 0 for numbers.
Extract ALL items if multiple are present.`;

export async function extractWithAI(
    rawText: string,
    originalFilename: string
): Promise<{ success: boolean; data: ParsedRfpData; confidence: number }> {
    const emptyResult: ParsedRfpData = {
        prNumber: "",
        supplyType: "",
        location: "",
        companyName: "",
        dueDate: "",
        items: [],
        rawText,
    };

    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error("GROQ_API_KEY is not set in environment variables");
        }

        const userMessage = `FILENAME: ${originalFilename}\n\nDOCUMENT TEXT:\n${rawText}`;

        const response = await axios.post(
            GROQ_API_URL,
            {
                model: GROQ_MODEL,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userMessage },
                ],
                temperature: 0.1,
                max_tokens: 4096,
                response_format: { type: "json_object" },
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 60000,
            }
        );

        const aiResponse = response.data?.choices?.[0]?.message?.content;
        if (!aiResponse) {
            return { success: false, data: emptyResult, confidence: 0 };
        }

        const jsonStr = extractJsonFromResponse(aiResponse);
        if (!jsonStr) {
            return { success: false, data: emptyResult, confidence: 0 };
        }

        const parsed = JSON.parse(jsonStr);
        const data = normalizeAIResponse(parsed, rawText);
        const confidence = calculateConfidence(data);

        return {
            success: confidence > 30,
            data,
            confidence,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown AI extraction error";
        console.error("AI extraction failed:", message);
        return { success: false, data: emptyResult, confidence: 0 };
    }
}

// Check if Groq API is reachable and key is valid
export async function isAIAvailable(): Promise<boolean> {
    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) return false;

        const response = await axios.get("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 5000,
        });
        return response.status === 200;
    } catch {
        return false;
    }
}

// Extract JSON from AI response that might contain markdown
function extractJsonFromResponse(response: string): string | null {
    // Try direct parse first
    try {
        JSON.parse(response);
        return response;
    } catch {
        // Not direct JSON
    }

    // Try to extract from markdown code block
    const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch?.[1]) {
        try {
            JSON.parse(codeBlockMatch[1]);
            return codeBlockMatch[1];
        } catch {
            // Invalid JSON in code block
        }
    }

    // Try to find JSON object in the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch?.[0]) {
        try {
            JSON.parse(jsonMatch[0]);
            return jsonMatch[0];
        } catch {
            // Not valid JSON
        }
    }

    return null;
}

// Normalize AI response to our expected format
function normalizeAIResponse(parsed: Record<string, unknown>, rawText: string): ParsedRfpData {
    const items: ParsedItem[] = [];
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    for (const rawItem of rawItems) {
        const item = rawItem as Record<string, unknown>;
        const tech = (item.technical || {}) as Record<string, unknown>;
        items.push({
            serialNumber: String(item.serialNumber || ""),
            itemCode: String(item.itemCode || ""),
            itemName: String(item.itemName || ""),
            itemDesc: String(item.itemDesc || ""),
            itemType: validateItemType(String(item.itemType || "UNIT")),
            uom: String(item.uom || ""),
            quantity: Number(item.quantity) || 0,
            drawingNumber: String(item.drawingNumber || ""),
            technical: {
                material: String(tech.material || ""),
                hardness: String(tech.hardness || ""),
                surfaceFinish: String(tech.surfaceFinish || ""),
                heatTreatment: String(tech.heatTreatment || ""),
                diameter: String(tech.diameter || ""),
                length: String(tech.length || ""),
                weight: String(tech.weight || ""),
                grade: String(tech.grade || ""),
            },
        });
    }

    return {
        prNumber: String(parsed.prNumber || ""),
        supplyType: String(parsed.supplyType || ""),
        location: String(parsed.location || ""),
        companyName: String(parsed.companyName || ""),
        dueDate: String(parsed.dueDate || ""),
        items,
        rawText,
    };
}

function validateItemType(type: string): "SET" | "ASSEMBLY" | "UNIT" {
    const upper = type.toUpperCase();
    if (upper === "SET" || upper === "ASSEMBLY" || upper === "UNIT") {
        return upper;
    }
    return "UNIT";
}

// Calculate confidence score (0-100) based on how many fields were extracted
function calculateConfidence(data: ParsedRfpData): number {
    let score = 0;
    const maxScore = 100;

    // RFQ-level fields (30 points)
    if (data.prNumber) score += 10;
    if (data.location) score += 10;
    if (data.companyName) score += 5;
    if (data.supplyType) score += 5;

    // Item-level fields (70 points distributed across items)
    if (data.items.length > 0) {
        score += 10; // Has at least one item

        let itemScore = 0;
        for (const item of data.items) {
            let perItemScore = 0;
            if (item.itemCode) perItemScore += 15;
            if (item.itemName) perItemScore += 10;
            if (item.quantity > 0) perItemScore += 15;
            if (item.uom) perItemScore += 5;
            if (item.technical.material) perItemScore += 5;
            if (item.drawingNumber) perItemScore += 5;
            // Max per item = 55
            itemScore += perItemScore;
        }
        // Average across items, scaled to 60 points
        score += Math.min(60, itemScore / data.items.length);
    }

    return Math.min(maxScore, Math.round(score));
}
