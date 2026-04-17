import { extractTextFromFile, parseRfpDocument, ParsedRfpData } from "./docParser";
import { extractWithAI, isAIAvailable, ProviderConfig } from "./aiExtractor";

export interface ExtractionResult {
    success: boolean;
    layer: "AI" | "PARSER" | "MANUAL";
    status: "FULL" | "PARTIAL" | "FAILED";
    confidence: number;
    data: ParsedRfpData;
    errors: string[];
    providerName?: string;
}

// Defined as a function so env vars are read at request time (after dotenv loads), not at module init
function getAIProviders(): ProviderConfig[] {
    return [
        {
            name: "Groq",
            apiUrl: "https://api.groq.com/openai/v1/chat/completions",
            model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
            apiKey: process.env.GROQ_API_KEY || "",
        },
        {
            name: "Cerebras",
            apiUrl: "https://api.cerebras.ai/v1/chat/completions",
            model: "qwen-3-235b-a22b-instruct-2507",
            apiKey: process.env.CEREBRAS_API_KEY || "",
        },
        {
            name: "OpenRouter",
            apiUrl: "https://openrouter.ai/api/v1/chat/completions",
            model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
            apiKey: process.env.OPENROUTER_API_KEY || "",
        },
    ];
}

// Orchestrates the 3-layer extraction pipeline:
// Layer 1: AI providers (Groq → Cerebras → OpenRouter) → Layer 2: JS Parser → Layer 3: Manual
export async function runExtractionPipeline(
    filePath: string,
    originalFilename: string
): Promise<ExtractionResult> {
    const errors: string[] = [];
    let rawText = "";

    // Step 1: Extract raw text from document (needed by all layers)
    try {
        rawText = await extractTextFromFile(filePath);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Text extraction failed";
        errors.push(`Text extraction error: ${msg}`);
    }

    // Layer 1: Try AI providers in order
    if (rawText) {
        const activeProviders = getAIProviders().filter(p => p.apiKey !== "");

        for (const provider of activeProviders) {
            try {
                const aiUp = await isAIAvailable(provider);
                if (!aiUp) {
                    errors.push(`${provider.name} AI service not available, trying next provider`);
                    continue;
                }

                const aiResult = await extractWithAI(rawText, originalFilename, provider);

                if (aiResult.success && aiResult.confidence >= 50) {
                    return {
                        success: true,
                        layer: "AI",
                        status: aiResult.confidence >= 80 ? "FULL" : "PARTIAL",
                        confidence: aiResult.confidence,
                        data: aiResult.data,
                        errors: [],
                        providerName: provider.name,
                    };
                }
                if (aiResult.confidence > 0 && aiResult.confidence < 50) {
                    errors.push(`${provider.name} returned low confidence (${aiResult.confidence}%), trying next provider`);
                } else if (aiResult.confidence === 0) {
                    errors.push(`${provider.name} returned no usable data (confidence 0%), trying next provider`);
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : "AI extraction failed";
                errors.push(`${provider.name} error: ${msg}`);
            }
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
        startDate: "",
        dueDate: "",
        items: [],
        rawText,
    };

    // Try to at least parse the filename for some metadata
    const filenameMatch = originalFilename.match(
        /RFP\s*-\s*(\d{10})-(\d{10})-(.+?)-([A-Z]+(?:\s*-\s*[A-Z]+)*)-(.+)\.(doc|docx|pdf)$/i
    );
    if (filenameMatch) {
        manualData.prNumber = filenameMatch[1] ?? "";
        manualData.supplyType = filenameMatch[3]?.trim() ?? "";
        manualData.location = filenameMatch[4]?.trim() ?? "";
    }
    // Also try Templates pattern
    if (!manualData.prNumber) {
        const templatesMatch = originalFilename.match(
            /RFP\s+Templates[_-]PR[_-](\d{10})[_-](\d{10})[_-]([A-Z_]+)/i
        );
        if (templatesMatch) {
            manualData.prNumber = templatesMatch[1] ?? "";
            manualData.location = (templatesMatch[3] ?? "").replace(/_/g, " ").trim();
        }
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
