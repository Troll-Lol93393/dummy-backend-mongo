import { getFinancialYearLabel } from "../../utils/financialYear";

/**
 * Column mapping for the sales/dispatch CSV export.
 * Isolated here because the layout is fixed by the source system's export
 * format, not by anything in our control — if that export changes, this is
 * the only file that needs to change.
 *
 * Verified against a real export (23 columns, header row present):
 *   INVNO              Invoice Number             SE/2526/000001
 *   TDATE              Invoice Date/Time           09-04-2025 11:47
 *   PONO               PO Reference               either a bare PO number or a job-code
 *                                                  string with the PO number embedded
 *                                                  (e.g. VJNR/111300/REV/R/4100467174)
 *   PARTY              Company Name
 *   GSTIN              Customer GSTIN
 *   CONSIGNMENTNO      Consignment/LR number       alphanumeric; empty for historical rows,
 *                                                  required going forward
 *   TRANSPORTERID      Transporter master FK       NULL / 0 / 1 / 2 in observed exports
 *   TRANSPORTERNAME    Transporter Name
 *   TRANSPORTER_GSTIN  Transporter GSTIN
 *   EWAYBILLNO         E-way Bill Number           frequently corrupted to scientific
 *                                                  notation (e.g. 8.92E+11) by Excel —
 *                                                  imported as-is, flagged as a warning
 *   SRNO               Serial Number               line number within the invoice
 *   ICODE              Item Code
 *   IDESC              Item Name
 *   ISPEC              Material / Remarks          free text, often blank
 *   DRAWNO             Drawing Number
 *   UM                 UOM
 *   QNTY               Quantity
 *   RATE               Rate
 *   BAMT               Basic Value
 *   SGSTAMT            SGST Amount
 *   CGSTAMT            CGST Amount
 *   IGSTAMT            IGST Amount
 *   NAMT               Net Amount
 */
export const EXPECTED_HEADERS = [
    "INVNO",
    "TDATE",
    "PONO",
    "PARTY",
    "GSTIN",
    "CONSIGNMENTNO",
    "TRANSPORTERID",
    "TRANSPORTERNAME",
    "TRANSPORTER_GSTIN",
    "EWAYBILLNO",
    "SRNO",
    "ICODE",
    "IDESC",
    "ISPEC",
    "DRAWNO",
    "UM",
    "QNTY",
    "RATE",
    "BAMT",
    "SGSTAMT",
    "CGSTAMT",
    "IGSTAMT",
    "NAMT",
] as const;

/** A value that looks like an EWAYBILLNO mangled into scientific notation by Excel. */
const SCIENTIFIC_NOTATION_PATTERN = /^\d(\.\d+)?E\+\d+$/i;

/** PO numbers in this system are always 10 digits starting with 4. */
const PO_NUMBER_PATTERN = /\b4\d{9}\b/;

export interface ParsedSalesRow {
    invoiceNumber: string;
    invoiceDate: Date;
    dispatchDate: Date;
    financialYear: string;
    poReference: string;
    poNumber?: string;
    companyName: string;
    gstin?: string;
    consignmentNumber?: string;
    transporterId?: number;
    transporterName?: string;
    transporterGstin?: string;
    ewayBillNumber?: string;
    serialNumber: number;
    itemCode: string;
    itemName: string;
    materialRemarks?: string;
    drawingNumber?: string;
    uom?: string;
    quantity: number;
    rate: number;
    basicValue: number;
    sgstAmount: number;
    cgstAmount: number;
    igstAmount: number;
    netAmount: number;
}

/** A single CSV data row, keyed by header name (from csv-parse's `columns: true`). */
export type RawSalesRow = Record<string, string | undefined>;

function nullableString(val: string | undefined): string | undefined {
    if (!val) return undefined;
    const trimmed = val.trim();
    if (!trimmed || trimmed.toUpperCase() === "NULL") return undefined;
    return trimmed;
}

function nullableNumber(val: string | undefined): number | undefined {
    const str = nullableString(val);
    if (str === undefined) return undefined;
    const num = Number(str);
    return isNaN(num) ? undefined : num;
}

function parseInvoiceDate(val: string | undefined): Date | undefined {
    const str = nullableString(val);
    if (!str) return undefined;
    // "09-04-2025 11:47" (DD-MM-YYYY HH:mm) -> Date
    const match = str.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
    if (!match) return undefined;
    const [, day, month, year, hour, minute] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    return isNaN(date.getTime()) ? undefined : date;
}

export function extractPoNumber(poReference: string): string | undefined {
    const match = poReference.match(PO_NUMBER_PATTERN);
    return match ? match[0] : undefined;
}

export function isScientificNotation(val: string | undefined): boolean {
    return !!val && SCIENTIFIC_NOTATION_PATTERN.test(val.trim());
}

/** A basic sanity check — item codes in this system are plain digit strings. */
export function looksLikeValidItemCode(val: string): boolean {
    return /^\d+$/.test(val);
}

/**
 * Map a single raw CSV row (keyed by header name) to a Sales record.
 * Returns an error reason (rather than throwing) when the row is missing
 * data required to be useful, and a list of non-fatal warnings for values
 * that were imported as-is despite looking corrupted, so the caller can
 * report both without aborting the whole import.
 */
export function mapRowToSales(
    row: RawSalesRow,
    rowNumber: number
): { record: ParsedSalesRow; warnings: string[] } | { error: string } {
    const invoiceNumber = nullableString(row.INVNO);
    if (!invoiceNumber) {
        return { error: `Row ${rowNumber}: missing invoice number` };
    }

    const invoiceDate = parseInvoiceDate(row.TDATE);
    if (!invoiceDate) {
        return { error: `Row ${rowNumber}: missing or unparseable invoice date (${row.TDATE ?? ""})` };
    }

    const itemCode = nullableString(row.ICODE);
    if (!itemCode) {
        return { error: `Row ${rowNumber}: missing item code` };
    }

    const serialNumber = nullableNumber(row.SRNO);
    if (serialNumber === undefined) {
        return { error: `Row ${rowNumber}: missing or invalid serial number` };
    }

    const warnings: string[] = [];

    if (!looksLikeValidItemCode(itemCode)) {
        warnings.push(
            `Row ${rowNumber}: item code "${itemCode}" doesn't look like a plain numeric code — imported as-is, likely corrupted by a spreadsheet tool`
        );
    }

    const ewayBillNumber = nullableString(row.EWAYBILLNO);
    if (isScientificNotation(ewayBillNumber)) {
        warnings.push(
            `Row ${rowNumber}: EWAYBILLNO "${ewayBillNumber}" is in scientific notation (Excel precision loss) — imported as-is`
        );
    }

    const poReference = nullableString(row.PONO) ?? "";

    const record: ParsedSalesRow = {
        invoiceNumber,
        invoiceDate,
        // Dispatch date proxy: invoiced == dispatched in this workflow (e-way bill
        // is raised at the point of movement), confirmed with the business owner.
        dispatchDate: invoiceDate,
        financialYear: getFinancialYearLabel(invoiceDate),
        poReference,
        poNumber: extractPoNumber(poReference),
        companyName: nullableString(row.PARTY) ?? "",
        gstin: nullableString(row.GSTIN),
        consignmentNumber: nullableString(row.CONSIGNMENTNO),
        transporterId: nullableNumber(row.TRANSPORTERID),
        transporterName: nullableString(row.TRANSPORTERNAME),
        transporterGstin: nullableString(row.TRANSPORTER_GSTIN),
        ewayBillNumber,
        serialNumber,
        itemCode,
        itemName: nullableString(row.IDESC) ?? "",
        materialRemarks: nullableString(row.ISPEC),
        drawingNumber: nullableString(row.DRAWNO),
        uom: nullableString(row.UM),
        quantity: nullableNumber(row.QNTY) ?? 0,
        rate: nullableNumber(row.RATE) ?? 0,
        basicValue: nullableNumber(row.BAMT) ?? 0,
        sgstAmount: nullableNumber(row.SGSTAMT) ?? 0,
        cgstAmount: nullableNumber(row.CGSTAMT) ?? 0,
        igstAmount: nullableNumber(row.IGSTAMT) ?? 0,
        netAmount: nullableNumber(row.NAMT) ?? 0,
    };

    return { record, warnings };
}
