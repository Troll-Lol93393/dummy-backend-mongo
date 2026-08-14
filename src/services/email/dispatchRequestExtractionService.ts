import axios from "axios";
import XLSX from "xlsx";

import { IEmailAttachment } from "../../models/email.model";
import { logger } from "../../utils/logger";
import { retryWithBackoff } from "../../utils/retryWithBackoff";
import { extractPoNumbersFromText } from "./classificationService";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SPREADSHEET_TYPES = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
];

const MAX_ROWS_TO_AI = 200;

export interface DispatchRequestItem {
    poNumber: string;
    itemCode?: string;
}

function isSpreadsheetAttachment(attachment: IEmailAttachment): boolean {
    return SPREADSHEET_TYPES.includes(attachment.contentType) || /\.(xlsx|xls|csv)$/i.test(attachment.filename);
}

/**
 * Customer sheets arrive in whatever format the customer's team uses — no
 * fixed headers to rely on — so column mapping is handed to the AI instead
 * of a fixed-header parser.
 */
async function extractRowsWithAI(rows: Record<string, unknown>[]): Promise<DispatchRequestItem[]> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        logger.warn("DISPATCH_EXTRACT", "GROQ_API_KEY not set — skipping attachment extraction");
        return [];
    }

    const sample = rows.slice(0, MAX_ROWS_TO_AI);
    const prompt = `The rows below come from a customer's spreadsheet asking about the dispatch status of their purchase orders. Each row is a JSON object using the customer's own column headers, which vary and are not standardized.

For each row that contains one, identify:
- poNumber: a purchase order number (commonly a 10-digit number, often starting with 4)
- itemCode: a product/material/item code, if that row has one

Rows:
${JSON.stringify(sample)}

Respond ONLY with valid JSON: {"items": [{"poNumber": "4100617702", "itemCode": "ITM-1001"}]}. Skip rows with no identifiable PO number. Omit the itemCode key entirely for a row that has none.`;

    const response = await retryWithBackoff(
        () =>
            axios.post(
                GROQ_API_URL,
                {
                    model: GROQ_MODEL,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.1,
                    max_tokens: 2048,
                    response_format: { type: "json_object" },
                },
                {
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    timeout: 30000,
                }
            ),
        { maxRetries: 0, initialDelayMs: 2000 }
    );

    const text = response.data?.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as { items?: DispatchRequestItem[] };
    return (parsed.items || []).filter(
        (item): item is DispatchRequestItem => typeof item.poNumber === "string" && item.poNumber.trim().length > 0
    );
}

async function extractFromAttachment(attachment: IEmailAttachment): Promise<DispatchRequestItem[]> {
    if (!attachment.cloudinaryUrl || !isSpreadsheetAttachment(attachment)) return [];

    const response = await axios.get<ArrayBuffer>(attachment.cloudinaryUrl, {
        responseType: "arraybuffer",
        timeout: 20000,
    });
    const workbook = XLSX.read(response.data, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];

    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) return [];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rows.length === 0) return [];

    return extractRowsWithAI(rows);
}

/**
 * A PO can appear both as a bare body-text mention (no item code) and again
 * in an attachment row (with an item code) — when both exist for the same
 * PO, keep only the item-code-qualified entries, since those are what the
 * matching phase needs for per-PO-and-item precision.
 */
function dedupeByPoNumber(items: DispatchRequestItem[]): DispatchRequestItem[] {
    const byPo = new Map<string, DispatchRequestItem[]>();
    for (const item of items) {
        const group = byPo.get(item.poNumber) || [];
        group.push(item);
        byPo.set(item.poNumber, group);
    }

    const deduped: DispatchRequestItem[] = [];
    for (const group of byPo.values()) {
        const withItemCode = group.filter(g => g.itemCode);
        if (withItemCode.length === 0) {
            deduped.push({ poNumber: group[0]!.poNumber });
            continue;
        }
        const seenCodes = new Set<string>();
        for (const g of withItemCode) {
            if (g.itemCode && !seenCodes.has(g.itemCode)) {
                seenCodes.add(g.itemCode);
                deduped.push(g);
            }
        }
    }
    return deduped;
}

export async function extractDispatchRequests(email: {
    subject: string;
    textBody: string;
    attachments: IEmailAttachment[];
}): Promise<DispatchRequestItem[]> {
    const bodyPoNumbers = extractPoNumbersFromText(`${email.subject} ${email.textBody}`);
    const items: DispatchRequestItem[] = bodyPoNumbers.map(poNumber => ({ poNumber }));

    for (const attachment of email.attachments) {
        try {
            items.push(...(await extractFromAttachment(attachment)));
        } catch (err) {
            logger.warn("DISPATCH_EXTRACT", `Failed to extract from attachment ${attachment.filename}`, {
                error: String(err),
            });
        }
    }

    return dedupeByPoNumber(items);
}
