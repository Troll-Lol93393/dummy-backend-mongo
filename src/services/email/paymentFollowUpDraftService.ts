// JSW's "Template 3" (VSC Query Guidelines) HTML builders for the two
// vendor-help-desk follow-up drafts this pipeline creates:
//   - a SHORT PAYMENT RECEIVED query, for invoice rows the matching service
//     flagged as SHORT_PAYMENT
//   - a PAYMENT NOT RECEIVED query, for invoices >45 days overdue with no
//     payment received at all
//
// Pure HTML/string builders only — no DB access, no sending. Mirrors
// dispatchDraftGenerationService.ts's separation from the toggle-gated
// send/orchestration layer (paymentFollowUpAutoService.ts).

const VENDOR_NAME = "SHETH ENGINEERING";
const VENDOR_CODE = "10005778";
const BUSINESS = "STEEL";
const TO_BE_FILLED = "[TO BE FILLED]";

/** Best-effort context gathered from Sales/PORegister — blank/placeholder fields are fine, never guessed. */
export interface FollowUpInvoiceContext {
    poNumber?: string;
    barcode?: string;
    location?: string;
}

export interface ShortPaymentDraftInput extends FollowUpInvoiceContext {
    invoiceNumber: string;
    utrNo: string;
    amountReceived: number;
    shortfallAmount: number;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(amount: number): string {
    return amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Strips slashes from an invoice number for the short-payment subject line format (e.g. "SE/2627/000035" -> "SE2627000035"). */
function stripSlashes(invoiceNumber: string): string {
    return invoiceNumber.replace(/\//g, "");
}

export function buildShortPaymentSubject(invoiceNumber: string): string {
    return `[Short Payment Received against Invoice ${stripSlashes(invoiceNumber)}]`;
}

export function buildOverdueFollowUpSubject(invoiceNumber: string, invoiceDate: Date): string {
    const formatted = new Date(invoiceDate).toLocaleDateString("en-GB").replace(/\//g, "/");
    return `PAYMENT NOT RECEIVED AGAINST INVOICE NO: ${invoiceNumber} raised on ${formatted}`;
}

const LABEL_CELL_STYLE = "border:1px solid #d1d5db;padding:6px 10px;font-size:13px;background-color:#f3f4f6;font-weight:600;width:220px;";
const VALUE_CELL_STYLE = "border:1px solid #d1d5db;padding:6px 10px;font-size:13px;";

function templateRow(label: string, value: string): string {
    return `  <tr>
    <td style="${LABEL_CELL_STYLE}">${escapeHtml(label)}</td>
    <td style="${VALUE_CELL_STYLE}">${escapeHtml(value)}</td>
  </tr>`;
}

function templateTable(rows: string, reason: string, description: string): string {
    return `<table style="border-collapse:collapse;width:100%;max-width:640px;margin:12px 0;">
  <tbody>
${rows}
${templateRow("Reason for Query", reason)}
${templateRow("Description in Detail", description)}
  </tbody>
</table>`;
}

/**
 * SHORT PAYMENT RECEIVED query draft — for one invoice row the matching
 * service flagged as SHORT_PAYMENT. salesInvoiceTotal is the invoice's total
 * value from our own Sales records, included in the description for the
 * help desk's cross-reference.
 */
export function generateShortPaymentDraftHtml(input: ShortPaymentDraftInput, salesInvoiceTotal: number): string {
    const rows = [
        templateRow("Barcode No", input.barcode || TO_BE_FILLED),
        templateRow("Invoice No", input.invoiceNumber),
        templateRow("PO Number", input.poNumber || TO_BE_FILLED),
        templateRow("Vendor Name", VENDOR_NAME),
        templateRow("Vendor Code", VENDOR_CODE),
        templateRow("Location", input.location || ""),
        templateRow("Business", BUSINESS),
    ].join("\n");

    const description =
        `Invoice amount: Rs. ${formatCurrency(salesInvoiceTotal)}. ` +
        `Amount received (UTR ${input.utrNo}): Rs. ${formatCurrency(input.amountReceived)}. ` +
        `Shortfall: Rs. ${formatCurrency(input.shortfallAmount)}. ` +
        `Kindly review and release the balance amount at the earliest.`;

    return `<p>Dear Team,</p>
<p>We have received a short payment against the invoice below. Please find the details:</p>
${templateTable(rows, "SHORT PAYMENT RECEIVED", description)}
<p>Please let us know if you need any further details.</p>
<p>Regards,</p>`;
}

/**
 * PAYMENT NOT RECEIVED query draft — for an invoice >45 days overdue with no
 * payment received at all (no PaymentAdvice exists for it yet).
 */
export function generateOverdueFollowUpDraftHtml(
    invoiceNumber: string,
    invoiceDate: Date,
    daysOverdue: number,
    context: FollowUpInvoiceContext = {}
): string {
    const rows = [
        templateRow("Barcode No", context.barcode || TO_BE_FILLED),
        templateRow("Invoice No", invoiceNumber),
        templateRow("PO Number", context.poNumber || TO_BE_FILLED),
        templateRow("Vendor Name", VENDOR_NAME),
        templateRow("Vendor Code", VENDOR_CODE),
        templateRow("Location", context.location || ""),
        templateRow("Business", BUSINESS),
    ].join("\n");

    const description =
        `Invoice number ${invoiceNumber}, dated ${formatDate(invoiceDate)}, is now ${daysOverdue} day(s) overdue ` +
        `with no payment received to date. Kindly look into this at the earliest and confirm the payment status.`;

    return `<p>Dear Team,</p>
<p>The invoice below has not been paid and is now significantly overdue. Please find the details:</p>
${templateTable(rows, "PAYMENT NOT RECEIVED", description)}
<p>Please let us know if you need any further details.</p>
<p>Regards,</p>`;
}
