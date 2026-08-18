import { logger } from "../../utils/logger";

export interface ParsedPaymentAdviceRow {
    invoiceNumber: string;
    docDate: Date;
    bankPaymentDocNo: string;
    invoiceTotalAmount: number;
    tdsAmount: number;
    retentionAmount: number;
    otherHoldAmount: number;
    previousPaidAmount: number;
}

export interface ParsedPaymentAdvice {
    utrNo: string;
    amount: number;
    paymentDate: Date;
    cmpReferenceNo: string;
    payerCompanyName: string;
    rows: ParsedPaymentAdviceRow[];
}

const MONTH_ABBREVIATIONS: Record<string, number> = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11,
};

/** Indian comma-grouped numbers (e.g. "2,25,554.88") — strip commas before parseFloat. */
function stripCommasToFloat(value: string | undefined): number {
    if (!value) return 0;
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Parses "DD-MM-YYYY" — the header UTR/amount/date line format. */
function parseDdMmYyyy(value: string): Date | null {
    const m = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Parses "DD-MON-YY" / "DD-MON-YYYY" — the invoice row doc-date format (e.g. "23-JUN-26"). */
function parseDdMonYy(value: string): Date | null {
    const m = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (!m) return null;
    const [, dd, mon, yy] = m;
    const monthIndex = MONTH_ABBREVIATIONS[mon!.toUpperCase()];
    if (monthIndex === undefined) return null;
    const year = yy!.length === 2 ? 2000 + Number(yy) : Number(yy);
    const date = new Date(year, monthIndex, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
}

// "SBINR12026081338876109 2,25,554.88 13-08-2026 CUSTOMER_REF_NO(2300008725) AOD463629300001 CMP00000001535138658"
//
// pdf-parse's text extraction wraps this PDF's fixed-width table at a fixed
// character column, not at token/word boundaries — on some real advices the
// "CUSTOMER_REF_NO(...)" segment gets split across 2-3 lines, sometimes
// mid-digit (e.g. "CUSTOMER_\nREF_NO(2300\n008893)"). That reference number
// isn't otherwise used (only needed here to anchor the header match), so
// rather than trying to reconstruct it, the pattern just tolerates
// whitespace/newlines anywhere inside it.
const HEADER_LINE_PATTERN =
    /([A-Z0-9]{10,30})\s+([\d,]+\.\d{2})\s+(\d{2}-\d{2}-\d{4})\s+CUSTOMER_\s*REF_NO\s*\(\s*[\d\s]+\)\s+(\S+)\s+(CMP\S+)/i;

function parseHeader(rawText: string): {
    utrNo: string;
    amount: number;
    paymentDate: Date;
    cmpReferenceNo: string;
} | null {
    const match = rawText.match(HEADER_LINE_PATTERN);
    if (!match) return null;

    const [, utrNo, amountStr, dateStr, , cmpRefRaw] = match;
    const paymentDate = parseDdMmYyyy((dateStr || "").trim());
    if (!paymentDate || !utrNo || !cmpRefRaw) return null;

    return {
        utrNo: utrNo.trim(),
        amount: stripCommasToFloat(amountStr),
        paymentDate,
        cmpReferenceNo: cmpRefRaw.trim(),
    };
}

function parsePayerCompanyName(rawText: string): string {
    const firstLine = rawText
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.length > 0);
    return firstLine || "";
}

// Sheth's own invoice numbers look like "SE/2627/000038" — anchoring row
// extraction on this pattern (rather than naive whitespace splitting) is
// what keeps multi-invoice advices from getting their rows misaligned when
// pdf-parse flattens the PDF's multi-column table into plain text.
const INVOICE_NUMBER_PATTERN = /SE\/\d{4}\/\d{6}/g;
const ROW_DATE_PATTERN = /\d{2}-[A-Za-z]{3}-\d{2,4}/;
const NUMERIC_TOKEN_PATTERN = /[\d,]+\.?\d*/g;

/**
 * Parses the invoice allocation rows. Each row is "windowed" from its own
 * invoice-number match up to (but not including) the next invoice-number
 * match — or end of text for the last row — so numbers belonging to a
 * different row can never bleed into this one. Within a row's window, the
 * doc-date is located first, then the trailing numeric tokens immediately
 * after it are read off in the fixed column order the SBI advice always
 * uses: bank payment doc no, then the 5 amount fields.
 *
 * Never throws on a malformed/ambiguous row — logs a warning instead so it
 * surfaces for manual review, and still returns whatever could be parsed.
 */
function parseInvoiceRows(rawText: string): { rows: ParsedPaymentAdviceRow[]; warnings: string[] } {
    const warnings: string[] = [];
    const matches = [...rawText.matchAll(INVOICE_NUMBER_PATTERN)];
    const rows: ParsedPaymentAdviceRow[] = [];

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (!match || match.index === undefined) continue;

        const invoiceNumber = match[0];
        const windowStart = match.index + invoiceNumber.length;
        const nextMatch = matches[i + 1];
        const windowEnd = nextMatch?.index ?? rawText.length;
        const window = rawText.slice(windowStart, windowEnd);

        const dateMatch = window.match(ROW_DATE_PATTERN);
        if (!dateMatch || dateMatch.index === undefined) {
            warnings.push(`No doc-date found for invoice row ${invoiceNumber} — skipping row`);
            continue;
        }
        const docDate = parseDdMonYy(dateMatch[0]);
        if (!docDate) {
            warnings.push(
                `Unparseable doc-date "${dateMatch[0]}" for invoice row ${invoiceNumber} — skipping row`
            );
            continue;
        }

        const afterDate = window.slice(dateMatch.index + dateMatch[0].length);
        const numberTokens = afterDate.match(NUMERIC_TOKEN_PATTERN) || [];

        if (numberTokens.length < 6) {
            warnings.push(
                `Expected bank-doc-no + 5 amount fields for invoice row ${invoiceNumber}, found only ` +
                    `${numberTokens.length} numeric token(s) — missing fields default to 0, verify manually`
            );
        }

        rows.push({
            invoiceNumber,
            docDate,
            bankPaymentDocNo: numberTokens[0] || "",
            invoiceTotalAmount: stripCommasToFloat(numberTokens[1]),
            tdsAmount: stripCommasToFloat(numberTokens[2]),
            retentionAmount: stripCommasToFloat(numberTokens[3]),
            otherHoldAmount: stripCommasToFloat(numberTokens[4]),
            previousPaidAmount: stripCommasToFloat(numberTokens[5]),
        });
    }

    // Dedupe rows that are the same underlying line rendered twice by the
    // source PDF (observed in real advices: one occurrence shows the total
    // with TDS=0, another shows the same invoice with TDS split out — the
    // raw totals differ, but Total-minus-TDS lands on the identical expected
    // net amount both times). Comparing raw invoiceTotalAmount alone misses
    // this, so the real signal is "same invoice number + same expected net
    // amount within a rupee" — genuinely separate charges against the same
    // invoice number would compute to different expected net amounts and are
    // deliberately left untouched.
    const EXPECTED_NET_DEDUPE_TOLERANCE = 1;
    const keptExpectedNetsByInvoice = new Map<string, number[]>();
    const dedupedRows: ParsedPaymentAdviceRow[] = [];

    for (const row of rows) {
        const expectedNet = row.invoiceTotalAmount - row.tdsAmount;
        const priorNets = keptExpectedNetsByInvoice.get(row.invoiceNumber) || [];
        const isDuplicate = priorNets.some(
            net => Math.abs(net - expectedNet) <= EXPECTED_NET_DEDUPE_TOLERANCE
        );

        if (isDuplicate) {
            warnings.push(
                `Invoice row ${row.invoiceNumber} appears more than once with the same expected net amount ` +
                    `(Rs.${expectedNet.toFixed(2)}) — treated as the same line rendered twice by the source PDF, duplicate dropped`
            );
            continue;
        }

        dedupedRows.push(row);
        keptExpectedNetsByInvoice.set(row.invoiceNumber, [...priorNets, expectedNet]);
    }

    return { rows: dedupedRows, warnings };
}

/**
 * Parses one SBI CMP ePayment Advice PDF's extracted text into a structured
 * header + invoice-row breakdown. Returns null only when the mandatory
 * header line (UTR/amount/date/CMP-reference) can't be located at all —
 * that's the minimum needed to create a PaymentAdvice record.
 */
export function parsePaymentAdvicePdfText(rawText: string): ParsedPaymentAdvice | null {
    const header = parseHeader(rawText);
    if (!header) {
        logger.warn(
            "PAYMENT_ADVICE_PARSE",
            "Could not locate UTR/amount/date/CMP-reference header line in PDF text"
        );
        return null;
    }

    const { rows, warnings } = parseInvoiceRows(rawText);
    for (const warning of warnings) {
        logger.warn("PAYMENT_ADVICE_PARSE", warning, { cmpReferenceNo: header.cmpReferenceNo });
    }

    if (rows.length === 0) {
        logger.warn("PAYMENT_ADVICE_PARSE", "No invoice allocation rows found in PDF text", {
            cmpReferenceNo: header.cmpReferenceNo,
        });
    }

    return {
        ...header,
        payerCompanyName: parsePayerCompanyName(rawText),
        rows,
    };
}

// ─── Self-check ──────────────────────────────────────────────────────────
// Not wired into any production path, cron job, or test runner (this repo
// has no test harness for this pipeline yet) — a quick manual verification
// that the parser reproduces the confirmed real-world example from the
// feature spec exactly. Call selfCheckPaymentAdvicePdfParser() directly
// (e.g. from a REPL/one-off script) after touching this file.

const SAMPLE_ADVICE_TEXT = `JSW STEEL LTD VIJAYA NAGAR PLANT
Our A/c no 00000035572680664 IFSC SBIN0040558 MUMBAI 400051
PAYMENT ADVICE
UTR_NO AMOUNT(INR) DATE LINKAGE_FIELD E-CHEQUE NO. CMP REFERENCE NO.
SBINR12026081338876109 2,25,554.88 13-08-2026 CUSTOMER_REF_NO(2300008725) AOD463629300001 CMP00000001535138658
INV-BILL NO DOC DATE BANK PAYMENT DOC NO INV_TOTAL_AMOUNT TDS AMOUNT RETENTION AMT OTHER HOLD AMT PREVIOUS PAID AMOUNT
SE/2627/000038 23-JUN-26 2300008725 225746.19 191.31 0 0 0`;

export function selfCheckPaymentAdvicePdfParser(): boolean {
    const result = parsePaymentAdvicePdfText(SAMPLE_ADVICE_TEXT);
    if (!result) return false;

    const row = result.rows[0];
    const ok =
        result.utrNo === "SBINR12026081338876109" &&
        result.amount === 225554.88 &&
        result.cmpReferenceNo === "CMP00000001535138658" &&
        result.rows.length === 1 &&
        !!row &&
        row.invoiceNumber === "SE/2627/000038" &&
        row.bankPaymentDocNo === "2300008725" &&
        row.invoiceTotalAmount === 225746.19 &&
        row.tdsAmount === 191.31 &&
        row.retentionAmount === 0 &&
        row.otherHoldAmount === 0 &&
        row.previousPaidAmount === 0;

    if (!ok) {
        logger.error("PAYMENT_ADVICE_PARSE", "Self-check FAILED against known sample advice text", {
            result: JSON.stringify(result),
        });
    }
    return ok;
}
