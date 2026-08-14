import { DispatchMatchResult } from "./dispatchMatchingService";

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

function notYetDispatchedRows(result: DispatchMatchResult): string {
    const items = result.orderedItems?.length
        ? result.orderedItems
        : [{ itemCode: result.itemCode || "—", itemDescription: "—", quantity: 0 }];

    return items
        .map(
            i => `<tr>
    <td style="${CELL_STYLE}">${escapeHtml(result.poNumber)}</td>
    <td style="${CELL_STYLE}">${escapeHtml(i.itemCode)}</td>
    <td style="${CELL_STYLE}">${escapeHtml(i.itemDescription)}</td>
    <td style="${CELL_STYLE}">—</td>
    <td style="${CELL_STYLE}">${i.quantity || "—"}</td>
    <td style="${CELL_STYLE}">—</td>
    <td style="${CELL_STYLE}">—</td>
    <td style="${CELL_STYLE};color:#b45309;font-weight:600;">Not yet dispatched</td>
  </tr>`
        )
        .join("\n");
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
 * Excel attachment) — one row per dispatched line item, or a single
 * placeholder row per PO for the not-yet-dispatched / not-found buckets.
 * This is always a DRAFT: nothing here sends the email, a human reviews and
 * edits it before it goes out via the existing reply endpoint.
 */
export function generateDispatchStatusDraftHtml(results: DispatchMatchResult[]): string {
    const rows = results
        .map(result => {
            if (result.status === "DISPATCHED") return dispatchedRows(result);
            if (result.status === "NOT_YET_DISPATCHED") return notYetDispatchedRows(result);
            return poNotFoundRow(result);
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
