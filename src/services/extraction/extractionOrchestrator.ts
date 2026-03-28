import { extractTextFromFile, parseRfpDocument, ParsedRfpData } from "./docParser";
import { extractWithAI, isAIAvailable } from "./aiExtractor";

export interface ExtractionResult {
    success: boolean;
    layer: "AI" | "PARSER" | "MANUAL";
    status: "FULL" | "PARTIAL" | "FAILED";
    confidence: number;
    data: ParsedRfpData;
    errors: string[];
}

// Orchestrates the 3-layer extraction pipeline:
// Layer 1: AI (Ollama) → Layer 2: JS Parser (mammoth/pdf-parse) → Layer 3: Manual
export async function runExtractionPipeline(
    filePath: string,
    originalFilename: string
): Promise<ExtractionResult> {
    const errors: string[] = [];
    let rawText = "";

    // Step 1: Extract raw text from document (needed by both layers)
    try {
        rawText = await extractTextFromFile(filePath);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Text extraction failed";
        errors.push(`Text extraction error: ${msg}`);
    }

    // Layer 1: Try AI extraction first
    if (rawText) {
        try {
            const aiUp = await isAIAvailable();
            if (aiUp) {
                const aiResult = await extractWithAI(rawText, originalFilename);
                if (aiResult.success && aiResult.confidence >= 50) {
                    return {
                        success: true,
                        layer: "AI",
                        status: aiResult.confidence >= 80 ? "FULL" : "PARTIAL",
                        confidence: aiResult.confidence,
                        data: aiResult.data,
                        errors: [],
                    };
                }
                if (aiResult.confidence > 0 && aiResult.confidence < 50) {
                    errors.push(
                        `AI extraction returned low confidence (${aiResult.confidence}%), falling back to parser`
                    );
                }
            } else {
                errors.push("Groq AI service not available, falling back to parser");
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "AI extraction failed";
            errors.push(`AI Layer error: ${msg}`);
        }
    }

    // Layer 2: Fallback to JS parser
    try {
        const parserResult = await parseRfpDocument(filePath, originalFilename);
        if (parserResult.success) {
            const confidence = calculateParserConfidence(parserResult.data);
            return {
                success: true,
                layer: "PARSER",
                status: parserResult.isPartial ? "PARTIAL" : "FULL",
                confidence,
                data: parserResult.data,
                errors,
            };
        }
        errors.push("Parser could not extract meaningful data");
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Parser extraction failed";
        errors.push(`Parser Layer error: ${msg}`);
    }

    // Layer 3: Manual — return whatever we have with raw text for manual entry
    const manualData: ParsedRfpData = {
        prNumber: "",
        supplyType: "",
        location: "",
        companyName: "",
        dueDate: "",
        items: [],
        rawText,
    };

    // Try to at least parse the filename for some metadata
    const filenameMatch = originalFilename.match(
        /^RFP\s*-\s*(\d{10})-(\d{10})-(.+?)-([A-Z]+)-(.+)\.(doc|docx|pdf)$/i
    );
    if (filenameMatch) {
        manualData.prNumber = filenameMatch[1] ?? "";
        manualData.supplyType = filenameMatch[3]?.trim() ?? "";
        manualData.location = filenameMatch[4]?.trim() ?? "";
    }

    return {
        success: false,
        layer: "MANUAL",
        status: "FAILED",
        confidence: 0,
        data: manualData,
        errors,
    };
}

function calculateParserConfidence(data: ParsedRfpData): number {
    let score = 0;
    if (data.prNumber) score += 15;
    if (data.location) score += 10;
    if (data.companyName) score += 10;
    if (data.supplyType) score += 5;
    if (data.items.length > 0) {
        score += 10;
        for (const item of data.items) {
            if (item.itemCode) score += 10;
            if (item.quantity > 0) score += 10;
            if (item.itemName) score += 5;
            if (item.uom) score += 5;
            if (item.technical.material) score += 5;
        }
        score = Math.min(100, score);
    }
    return score;
}
