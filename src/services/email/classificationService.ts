import axios from "axios";
import { Email, IEmail, EMAIL_CATEGORIES, EmailCategory } from "../../models/email.model";
import { RFQ } from "../../models/rfq.models";
import { PORegister } from "../../models/poRegister.model";
import { logger } from "../../utils/logger";
import { retryWithBackoff } from "../../utils/retryWithBackoff";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const CLASSIFICATION_SYSTEM_PROMPT = `You are an AI assistant that classifies procurement/vendor emails for Sheth Engineering, a manufacturing company.

Classify each email into exactly ONE of these categories:
- NEW_RFQ: New RFP/RFQ invitation (Ariba event, direct PDF attachment with quote request). Keywords: "invited you to participate", "request for quotation", "RFP", "submit your quote"
- RFQ_REMINDER: Reminder to submit an already-known quote. Keywords: "reminder", "pending response", "approaching deadline"
- RFQ_REOPENED: A previously closed RFQ/RFP event that has been reopened. Keywords: "has been reopened", "event reopened", "rfp reopened", "rfq reopened"
- REVISION_NEGOTIATION: Price or spec revision request on existing quote. Keywords: "revision", "negotiate", "counter offer", "price reduction", "final no regret price", "no regret price", "update final no regret"
- PO_RELATED: NEW Purchase Order that needs to be registered. Subject pattern: "PO for NO.: 4100617702-Location". Keywords: "purchase order", "PO number", "order confirmation", "PO amendment"
- PO_DISCUSSION: Discussion/queries about an EXISTING Purchase Order. Keywords: "regarding PO", "query about order", "PO status"
- DELIVERY_SCHEDULE: Material delivery confirmations, goods receipt, dispatch. Keywords: "goods receipt received", "material received", "material receipt", "delivery note", "dispatch", "shipment", "GRN"
- MATERIAL_NOT_RECEIVED: Complaints about missing or delayed material. Keywords: "not received", "material missing", "pending delivery", "material not received"
- DRAWING_DOCUMENT: Drawing/document sharing (technical docs, specs). Keywords: "drawing", "attached document", "technical specification"
- GENERAL: Any other vendor communication that doesn't fit above

Extract these fields from the email subject and body:
- prNumbers: 10-digit numbers matching pattern 16XXXXXXXX (PR numbers)
- poNumbers: PO numbers found in text
- companyNames: Company/client names mentioned
- contactPerson: Sender or mentioned contact name
- contactEmail: Contact email if mentioned
- contactPhone: Contact phone if mentioned
- location: Location/site mentioned (e.g., "VIJAYANAGAR", "DOLVI")
- eventStartDate: Event/quote start date if mentioned (ISO format)
- dueDate: Deadline/due date if mentioned (ISO format)
- actionItems: List of actions required from Sheth Engineering
- summary: One-line summary of the email purpose

IMPORTANT: Do NOT extract item/product data from the email body. Only extract metadata for classification and linking.

Respond ONLY with valid JSON matching this structure:
{
  "category": "NEW_RFQ",
  "confidence": 85,
  "extractedData": {
    "prNumbers": ["1600631564"],
    "poNumbers": [],
    "companyNames": ["JSW Steel Limited"],
    "contactPerson": "Nuzahath khannam",
    "contactEmail": "",
    "contactPhone": "",
    "location": "VIJAYANAGAR",
    "eventStartDate": null,
    "dueDate": "2025-03-15T00:00:00.000Z",
    "actionItems": ["Submit quotation before deadline"],
    "summary": "JSW Steel invited Sheth Engineering to participate in RFQ for spare parts"
  }
}`;

interface ClassificationResult {
    category: EmailCategory;
    confidence: number;
    extractedData: {
        prNumbers: string[];
        poNumbers: string[];
        companyNames: string[];
        contactPerson?: string;
        contactEmail?: string;
        contactPhone?: string;
        location?: string;
        eventStartDate?: string | null;
        dueDate?: string | null;
        actionItems: string[];
        summary: string;
    };
}

/**
 * Classify a single email using Claude AI.
 */
async function classifyWithAI(email: IEmail): Promise<ClassificationResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY is not set in environment variables");
    }

    const prompt = `Classify this procurement email:

FROM: ${email.from.name} <${email.from.address}>
SUBJECT: ${email.subject}
DATE: ${email.date}

BODY:
${email.textBody?.substring(0, 3000) || "(no text body)"}

${email.attachments.length > 0 ? `ATTACHMENTS: ${email.attachments.map(a => a.filename).join(", ")}` : ""}
${email.aribaLinks.length > 0 ? `ARIBA LINKS: ${email.aribaLinks.length} link(s) found` : ""}`;

    const response = await retryWithBackoff(
        () =>
            axios.post(
                GROQ_API_URL,
                {
                    model: GROQ_MODEL,
                    messages: [
                        { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
                        { role: "user", content: prompt },
                    ],
                    temperature: 0.1,
                    max_tokens: 1024,
                    response_format: { type: "json_object" },
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 30000,
                }
            ),
        { maxRetries: 0, initialDelayMs: 2000 }
    );

    const text = response.data?.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error("AI response did not contain valid JSON");
    }

    const result: ClassificationResult = JSON.parse(jsonMatch[0]);

    // Validate category
    if (!EMAIL_CATEGORIES.includes(result.category)) {
        result.category = "GENERAL";
    }

    // Clamp confidence
    result.confidence = Math.max(0, Math.min(100, result.confidence || 0));

    return result;
}

/**
 * Extract PR numbers from text using regex as a fallback/supplement.
 */
function extractPrNumbersFromText(text: string): string[] {
    const matches = text.match(/\b16\d{8}\b/g);
    return matches ? [...new Set(matches)] : [];
}

/**
 * Extract PO numbers from text (patterns: "PO for NO.: 4100617702", "PO No. 4100617702", "PO Number 4100617702").
 */
function extractPoNumbersFromText(text: string): string[] {
    const patterns = [
        /PO\s+(?:for\s+)?NO\.?\s*:?\s*(\d{10})/gi,
        /PO\s+(?:Number|No\.?)\s*:?\s*(\d{10})/gi,
        /Purchase\s+Order\s+(?:No\.?|Number)\s*:?\s*(\d{10})/gi,
        /\b(4\d{9})\b/g, // PO numbers typically start with 4 and are 10 digits
    ];
    const results = new Set<string>();
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            results.add(match[1] || match[0]);
        }
    }
    return [...results];
}

/** Delivery-related keywords in subject */
const DELIVERY_KEYWORDS = [
    "goods receipt",
    "material received",
    "material receipt",
    "goods received",
    "delivery note",
    "dispatch advice",
    "shipment confirmation",
    "grn ",
    "gr received",
];

/** RFQ-related keywords in subject */
const RFQ_KEYWORDS = [
    "invited you to participate",
    "request for quotation",
    "request for proposal",
    "submit your quote",
    "sourcing event",
    "invitation to bid",
    "quotation request",
];

/** RFQ reopened keywords in subject */
const RFQ_REOPENED_KEYWORDS = [
    "has been reopened",
    "event reopened",
    "rfp reopened",
    "rfq reopened",
];

/** Revision / negotiation keywords in subject */
const REVISION_KEYWORDS = [
    "final no regret price",
    "no regret price",
    "reduce - final",
    "update final no regret",
    "price revision",
    "counter offer",
];

/** RFQ reminder keywords in subject */
const RFQ_REMINDER_KEYWORDS = [
    "reminder to submit",
    "pending response",
    "approaching deadline",
    "event is closing",
    "closing soon",
];

/** PO subject pattern: "PO for NO.: 4100617702-Vijayanagar Works" */
const PO_SUBJECT_PATTERN = /PO\s+(?:for\s+)?NO\.?\s*:?\s*(\d{10})/i;

/**
 * Subject-based pre-classification: detect category from subject keywords
 * before calling AI. Returns null if no strong match.
 */
async function preClassifyBySubject(
    subject: string,
    textBody: string
): Promise<{ category: EmailCategory; poNumbers: string[]; prNumbers: string[] } | null> {
    const subjectLower = subject.toLowerCase();
    const combined = `${subject} ${textBody}`;

    // 1. Revision / Negotiation (check first — "no regret price" is very specific)
    if (REVISION_KEYWORDS.some(kw => subjectLower.includes(kw))) {
        return {
            category: "REVISION_NEGOTIATION",
            poNumbers: extractPoNumbersFromText(combined),
            prNumbers: extractPrNumbersFromText(combined),
        };
    }

    // 2. RFQ Reopened
    if (RFQ_REOPENED_KEYWORDS.some(kw => subjectLower.includes(kw))) {
        return {
            category: "RFQ_REOPENED",
            poNumbers: [],
            prNumbers: extractPrNumbersFromText(combined),
        };
    }

    // 3. RFQ Reminder (explicit reminder keywords)
    if (RFQ_REMINDER_KEYWORDS.some(kw => subjectLower.includes(kw))) {
        return {
            category: "RFQ_REMINDER",
            poNumbers: [],
            prNumbers: extractPrNumbersFromText(combined),
        };
    }

    // 4. New RFQ keywords — check if PR already exists in DB (→ reminder, not new)
    if (RFQ_KEYWORDS.some(kw => subjectLower.includes(kw))) {
        const prNumbers = extractPrNumbersFromText(combined);
        if (prNumbers.length > 0) {
            const existingRfq = await RFQ.findOne({
                prNumber: { $in: prNumbers },
                isDeleted: false,
            })
                .select("_id")
                .lean();
            if (existingRfq) {
                return { category: "RFQ_REMINDER", poNumbers: [], prNumbers };
            }
        }
        return { category: "NEW_RFQ", poNumbers: [], prNumbers };
    }

    // 5. Delivery / Material received
    if (DELIVERY_KEYWORDS.some(kw => subjectLower.includes(kw))) {
        return {
            category: "DELIVERY_SCHEDULE",
            poNumbers: extractPoNumbersFromText(combined),
            prNumbers: [],
        };
    }

    // 6. PO email — check if subject matches PO pattern
    const poMatch = subject.match(PO_SUBJECT_PATTERN);
    if (poMatch && poMatch[1]) {
        const poNumber = poMatch[1];
        const allPoNumbers = extractPoNumbersFromText(combined);
        if (!allPoNumbers.includes(poNumber)) allPoNumbers.unshift(poNumber);

        // Check DB for existing PO
        const existingPo = await PORegister.findOne({
            poNumber: { $in: allPoNumbers },
            isDeleted: false,
        })
            .select("_id")
            .lean();

        if (existingPo) {
            return { category: "PO_DISCUSSION", poNumbers: allPoNumbers, prNumbers: [] };
        } else {
            return { category: "PO_RELATED", poNumbers: allPoNumbers, prNumbers: [] };
        }
    }

    // 7. Generic PO mention in subject (without specific pattern)
    if (
        subjectLower.includes("purchase order") ||
        subjectLower.includes("po confirmation") ||
        subjectLower.includes("po amendment")
    ) {
        const poNumbers = extractPoNumbersFromText(combined);
        if (poNumbers.length > 0) {
            const existingPo = await PORegister.findOne({
                poNumber: { $in: poNumbers },
                isDeleted: false,
            })
                .select("_id")
                .lean();
            return {
                category: existingPo ? "PO_DISCUSSION" : "PO_RELATED",
                poNumbers,
                prNumbers: [],
            };
        }
        return { category: "PO_RELATED", poNumbers, prNumbers: [] };
    }

    return null;
}

/**
 * Try to link email to existing RFQ by PR number or company name.
 */
async function findLinkedRfq(prNumbers: string[]): Promise<string | null> {
    // Only exact PR number match — no fuzzy matching
    if (prNumbers.length > 0) {
        const rfq = await RFQ.findOne({
            prNumber: { $in: prNumbers },
            isDeleted: false,
        })
            .select("_id")
            .lean();
        if (rfq) return String(rfq._id);
    }

    return null;
}

/**
 * Classify a single email and update the document.
 */
export async function classifyEmail(emailId: string): Promise<void> {
    const email = await Email.findById(emailId);
    if (!email) {
        logger.warn("CLASSIFY", `Email ${emailId} not found`);
        return;
    }

    try {
        const combinedText = `${email.subject} ${email.textBody}`;

        // Step 1: Subject-based pre-classification (fast, no AI needed)
        const preResult = await preClassifyBySubject(email.subject, email.textBody);

        // Step 2: AI classification — skip if subject rules already gave a confident match
        let result: ClassificationResult;
        if (preResult) {
            // Subject rule matched — no need to call Groq, saves quota for extraction
            result = {
                category: preResult.category,
                confidence: 90,
                extractedData: {
                    prNumbers: preResult.prNumbers,
                    poNumbers: preResult.poNumbers,
                    companyNames: [],
                    contactPerson: undefined,
                    contactEmail: undefined,
                    contactPhone: undefined,
                    location: undefined,
                    eventStartDate: null,
                    dueDate: null,
                    actionItems: [],
                    summary: "",
                },
            };
        } else {
            result = await classifyWithAI(email);
        }

        // Step 3: Merge regex-extracted PR & PO numbers with classified ones
        const regexPrNumbers = extractPrNumbersFromText(combinedText);
        const allPrNumbers = [
            ...new Set([...result.extractedData.prNumbers, ...regexPrNumbers]),
        ];
        result.extractedData.prNumbers = allPrNumbers;

        const regexPoNumbers = extractPoNumbersFromText(combinedText);
        const allPoNumbers = [
            ...new Set([...(result.extractedData.poNumbers || []), ...regexPoNumbers]),
        ];
        result.extractedData.poNumbers = allPoNumbers;

        // Update classification
        email.classification = {
            category: result.category,
            confidence: result.confidence,
            extractedData: {
                prNumbers: allPrNumbers,
                poNumbers: allPoNumbers,
                companyNames: result.extractedData.companyNames || [],
                contactPerson: result.extractedData.contactPerson,
                contactEmail: result.extractedData.contactEmail,
                contactPhone: result.extractedData.contactPhone,
                location: result.extractedData.location,
                eventStartDate: result.extractedData.eventStartDate
                    ? new Date(result.extractedData.eventStartDate)
                    : undefined,
                dueDate: result.extractedData.dueDate
                    ? new Date(result.extractedData.dueDate)
                    : undefined,
                actionItems: result.extractedData.actionItems || [],
                summary: result.extractedData.summary || "",
            },
        };

        // Auto-link to existing records
        const linkedRfqId = await findLinkedRfq(allPrNumbers);
        if (linkedRfqId) email.linkedRfq = linkedRfqId as unknown as typeof email.linkedRfq;

        email.isProcessed = true;
        await email.save();

        logger.info("CLASSIFY", `Classified email "${email.subject}" as ${result.category} (${result.confidence}%)`);
    } catch (err) {
        logger.error("CLASSIFY", `Failed to classify email ${emailId}`, {
            error: String(err),
        });
    }
}

/**
 * Classify all unprocessed emails in batches.
 */
export async function classifyUnprocessed(): Promise<number> {
    // Fresh start: only process emails received from Sunday April 5, 2026 onwards
    const PIPELINE_START_DATE = new Date("2026-04-05T00:00:00.000Z");

    const unprocessed = await Email.find({
        isProcessed: false,
        isDeleted: false,
        date: { $gte: PIPELINE_START_DATE },
    })
        .sort({ date: -1 })
        .limit(20)
        .select("_id");

    let classified = 0;

    for (const email of unprocessed) {
        await classifyEmail(String(email._id));
        classified++;
        // Rate limiting — 1s delay between classifications
        if (classified < unprocessed.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (classified > 0) {
        logger.info("CLASSIFY", `Classified ${classified} emails`);
    }

    return classified;
}
