import { DispatchMatchResult } from "./dispatchMatchingService";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

const CELL_STYLE = "border:1px solid #d1d5db;padding:6px 10px;font-size:13px;";
const HEADER_CELL_STYLE = `${CELL_STYLE}background-color:#f3f4f6;font-weight:600;text-align:left;`;

function dispatchedRows(result: DispatchMatchResult): string {
    return result.dispatches
        .map(
            d => `<tr>
    <td style="${CELL_STYLE}">${escapeHtml(result.poNumber)}</td>
    <td style="${CELL_STYLE}">${escapeHtml(d.itemCode)}</td>
    <td style="${CELL_STYLE}">${escapeHtml(d.itemName)}</td>
    <td style="${CELL_STYLE}">${formatDate(d.dispatchDate)}</td>
    <td style="${CELL_STYLE}">${d.quantity}</td>
    <td style="${CELL_STYLE}">${escapeHtml(d.transporterName || "—")}</td>
    <td style="${CELL_STYLE}">${escapeHtml(d.consignmentNumber || "—")}</td>
    <td style="${CELL_STYLE};color:#15803d;font-weight:600;">Dispatched</td>
  </tr>`
        )
        .join("\n");
}

/**
 * Standard placeholder line for whatever quantity hasn't shipped yet —
 * covers both "nothing dispatched" and "partially dispatched" cases. It's
 * deliberately generic (no invented ETA or reason) since this is always a
 * draft: a human reviewing it in Gmail can edit in a real reason/date before
 * sending, but the auto-draft itself must never assert a fact it can't back.
 */
function balanceRow(result: DispatchMatchResult): string {
    return `<tr>
    <td style="${CELL_STYLE}">${escapeHtml(result.poNumber)}</td>
    <td style="${CELL_STYLE}">${escapeHtml(result.itemCode)}</td>
    <td style="${CELL_STYLE}" colspan="5">${escapeHtml(result.itemDescription)} — Balance quantity of ${result.balanceQty} nos is under manufacturing and will be dispatched shortly. We will update you once dispatched.</td>
    <td style="${CELL_STYLE};color:#b45309;font-weight:600;">Pending</td>
  </tr>`;
}

function poNotFoundRow(result: DispatchMatchResult): string {
    return `<tr>
    <td style="${CELL_STYLE}">${escapeHtml(result.poNumber)}</td>
    <td style="${CELL_STYLE}" colspan="6">PO not found in our records — kindly reconfirm the PO number</td>
    <td style="${CELL_STYLE};color:#b91c1c;font-weight:600;">Not found</td>
  </tr>`;
}

/**
 * Renders the reply as an inline HTML table per the agreed format (not an
 * Excel attachment): dispatched line items get their real invoice/date/qty,
 * and any remaining balance (partial or fully pending) gets the placeholder
 * row — both can appear for the same PO/item when it was only partially
 * shipped. This is always a DRAFT: nothing here sends the email, a human
 * reviews and edits it before it goes out via the existing reply endpoint.
 */
export function generateDispatchStatusDraftHtml(results: DispatchMatchResult[]): string {
    const rows = results
        .map(result => {
            if (result.status === "PO_NOT_FOUND") return poNotFoundRow(result);
            const parts: string[] = [];
            if (result.dispatches.length > 0) parts.push(dispatchedRows(result));
            if (result.balanceQty > 0) parts.push(balanceRow(result));
            return parts.join("\n");
        })
        .join("\n");

    return `<p>Dear Sir/Madam,</p>
<p>Please find below the current dispatch status for your requested PO(s):</p>
<table style="border-collapse:collapse;width:100%;margin:12px 0;">
  <thead>
    <tr>
      <th style="${HEADER_CELL_STYLE}">PO Number</th>
      <th style="${HEADER_CELL_STYLE}">Item Code</th>
      <th style="${HEADER_CELL_STYLE}">Item Name</th>
      <th style="${HEADER_CELL_STYLE}">Dispatch Date</th>
      <th style="${HEADER_CELL_STYLE}">Qty</th>
      <th style="${HEADER_CELL_STYLE}">Transporter</th>
      <th style="${HEADER_CELL_STYLE}">Consignment No.</th>
      <th style="${HEADER_CELL_STYLE}">Status</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
<p>Please let us know if you need any further details.</p>
<p>Regards,</p>`;
}
