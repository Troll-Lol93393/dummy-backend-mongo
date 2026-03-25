import ExcelJS from "exceljs";
import { CompanyInfo } from "../shared/companyInfo";

interface CommercialItem {
    serialNumber: string;
    itemCode: string;
    itemName: string;
    material: string;
    quantity: number;
    sellingPrice: number;
    hsnCode: string;
    gstPercent: number;
    totalBeforeGst: number;
    gstAmount: number;
    totalWithGst: number;
}

interface CommercialOfferData {
    prNumber: string;
    companyName: string;
    location: string;
    ownerName: string;
    deliveryWeeks: number;
    items: CommercialItem[];
    grandTotalBeforeGst: number;
    grandGstAmount: number;
    grandTotalWithGst: number;
}

// ── Colors ──
const NAVY = "0F2B46";
const GOLD = "D4A017";
const WHITE = "FFFFFF";
const LIGHT_BG = "F4F8FB";
const HEADER_FONT = "FFFFFF";
const BORDER_COLOR = "BDC3C7";
const GREEN_BG = "EAFAF1";
const GREEN_BORDER = "27AE60";

type BorderStyle = "thin" | "medium";

function thinBorder(): Partial<ExcelJS.Borders> {
    const side: Partial<ExcelJS.Border> = {
        style: "thin" as BorderStyle,
        color: { argb: BORDER_COLOR },
    };
    return { top: side, bottom: side, left: side, right: side };
}

function formatCurrency(val: number): string {
    return val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function generateCommercialOfferExcel(
    data: CommercialOfferData,
    company: CompanyInfo
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.name;
    wb.created = new Date();

    const ws = wb.addWorksheet("Commercial Offer", {
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    // Column widths — 11 columns
    ws.columns = [
        { width: 8 }, // A — Sl No
        { width: 14 }, // B — Item Code
        { width: 28 }, // C — Item Name
        { width: 18 }, // D — Material
        { width: 8 }, // E — Qty
        { width: 16 }, // F — Sale Price
        { width: 14 }, // G — HSN Code
        { width: 10 }, // H — GST %
        { width: 18 }, // I — Total Before GST
        { width: 14 }, // J — GST Amt
        { width: 18 }, // K — Total with GST
    ];

    let row = 1;

    // ══════════════════════════════════════
    // LETTERHEAD
    // ══════════════════════════════════════

    // Row 1: Company name
    ws.mergeCells(`A${row}:K${row}`);
    const companyCell = ws.getCell(`A${row}`);
    companyCell.value = company.name;
    companyCell.font = { name: "Calibri", size: 18, bold: true, color: { argb: HEADER_FONT } };
    companyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    companyCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = 36;
    row++;

    // Row 2: Tagline
    ws.mergeCells(`A${row}:K${row}`);
    const tagCell = ws.getCell(`A${row}`);
    tagCell.value = company.tagline || "";
    tagCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "8FAABE" } };
    tagCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    tagCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = 20;
    row++;

    // Row 3: Gold accent strip
    ws.mergeCells(`A${row}:K${row}`);
    ws.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
    ws.getRow(row).height = 4;
    row++;

    // Row 4: Details
    ws.mergeCells(`A${row}:D${row}`);
    ws.getCell(`A${row}`).value = "GSTIN: " + (company.gstin || "—");
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.mergeCells(`E${row}:G${row}`);
    ws.getCell(`E${row}`).value = "Vendor Code: " + (company.vendorCode || "—");
    ws.getCell(`E${row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.mergeCells(`H${row}:K${row}`);
    ws.getCell(`H${row}`).value =
        `Date: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    ws.getCell(`H${row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.getCell(`H${row}`).alignment = { horizontal: "right" };
    ws.getRow(row).height = 18;
    row++;

    // Row 5: Address
    ws.mergeCells(`A${row}:K${row}`);
    ws.getCell(`A${row}`).value =
        [company.address, company.phone ? `Ph: ${company.phone}` : ""]
            .filter(Boolean)
            .join("  |  ") || "—";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 8, color: { argb: "555555" } };
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getRow(row).height = 16;
    row++;

    // Blank separator
    ws.getRow(row).height = 8;
    row++;

    // ══════════════════════════════════════
    // SUBJECT LINE
    // ══════════════════════════════════════
    ws.mergeCells(`A${row}:K${row}`);
    const subjectCell = ws.getCell(`A${row}`);
    subjectCell.value = `COMMERCIAL OFFER — RFQ No: ${data.prNumber}`;
    subjectCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: NAVY } };
    subjectCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EAF2F8" } };
    subjectCell.alignment = { horizontal: "center", vertical: "middle" };
    subjectCell.border = thinBorder();
    ws.getRow(row).height = 28;
    row++;

    // Company | Location
    ws.mergeCells(`A${row}:F${row}`);
    ws.getCell(`A${row}`).value = `Company: ${data.companyName}    |    Location: ${data.location}`;
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10 };
    ws.mergeCells(`G${row}:K${row}`);
    ws.getCell(`G${row}`).value = `Owner: ${data.ownerName}`;
    ws.getCell(`G${row}`).font = { name: "Calibri", size: 10 };
    ws.getCell(`G${row}`).alignment = { horizontal: "right" };
    ws.getRow(row).height = 20;
    row++;

    // Blank
    ws.getRow(row).height = 8;
    row++;

    // ══════════════════════════════════════
    // TABLE HEADER
    // ══════════════════════════════════════
    const tableHeaders = [
        "Sl No.",
        "Item Code",
        "Item Name",
        "Material",
        "Qty",
        "Sale Price (₹)",
        "HSN Code",
        "GST %",
        "Total Before GST (₹)",
        "GST Amount (₹)",
        "Total with GST (₹)",
    ];
    const headerRow = ws.getRow(row);
    tableHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: "Calibri", size: 9, bold: true, color: { argb: HEADER_FONT } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder();
    });
    headerRow.height = 24;
    row++;

    // ══════════════════════════════════════
    // DATA ROWS
    // ══════════════════════════════════════
    data.items.forEach((item, idx) => {
        const isEven = idx % 2 === 0;
        const bgColor = isEven ? LIGHT_BG : WHITE;

        const values = [
            item.serialNumber || String(idx + 1),
            item.itemCode,
            item.itemName,
            item.material || "—",
            item.quantity,
            formatCurrency(item.sellingPrice),
            item.hsnCode,
            `${item.gstPercent}%`,
            formatCurrency(item.totalBeforeGst),
            formatCurrency(item.gstAmount),
            formatCurrency(item.totalWithGst),
        ];

        const dataRow = ws.getRow(row);
        values.forEach((v, i) => {
            const cell = dataRow.getCell(i + 1);
            cell.value = v;
            cell.font = { name: "Calibri", size: 9, bold: i === 0 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
            cell.alignment = {
                horizontal: i >= 4 ? "right" : "left",
                vertical: "middle",
                wrapText: true,
            };
            cell.border = thinBorder();
        });
        dataRow.height = 20;
        row++;
    });

    // ══════════════════════════════════════
    // TOTALS
    // ══════════════════════════════════════

    // Blank
    ws.getRow(row).height = 6;
    row++;

    // Total Before GST
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value = "Total Before GST";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10, bold: true };
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).border = thinBorder();
    ws.mergeCells(`I${row}:K${row}`);
    ws.getCell(`I${row}`).value = `₹ ${formatCurrency(data.grandTotalBeforeGst)}`;
    ws.getCell(`I${row}`).font = { name: "Calibri", size: 10, bold: true };
    ws.getCell(`I${row}`).alignment = { horizontal: "right" };
    ws.getCell(`I${row}`).border = thinBorder();
    ws.getCell(`I${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BG } };
    ws.getRow(row).height = 22;
    row++;

    // GST Amount
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value = "Total GST (18%)";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10, bold: true };
    ws.getCell(`A${row}`).alignment = { horizontal: "right" };
    ws.getCell(`A${row}`).border = thinBorder();
    ws.mergeCells(`I${row}:K${row}`);
    ws.getCell(`I${row}`).value = `₹ ${formatCurrency(data.grandGstAmount)}`;
    ws.getCell(`I${row}`).font = { name: "Calibri", size: 10, bold: true };
    ws.getCell(`I${row}`).alignment = { horizontal: "right" };
    ws.getCell(`I${row}`).border = thinBorder();
    ws.getCell(`I${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FEF9E7" } };
    ws.getRow(row).height = 22;
    row++;

    // Grand Total
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value = "GRAND TOTAL";
    ws.getCell(`A${row}`).font = {
        name: "Calibri",
        size: 12,
        bold: true,
        color: { argb: HEADER_FONT },
    };
    ws.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    ws.getCell(`A${row}`).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(`A${row}`).border = thinBorder();
    ws.mergeCells(`I${row}:K${row}`);
    ws.getCell(`I${row}`).value = `₹ ${formatCurrency(data.grandTotalWithGst)}`;
    ws.getCell(`I${row}`).font = {
        name: "Calibri",
        size: 12,
        bold: true,
        color: { argb: HEADER_FONT },
    };
    ws.getCell(`I${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    ws.getCell(`I${row}`).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(`I${row}`).border = thinBorder();
    ws.getRow(row).height = 28;
    row++;

    // ══════════════════════════════════════
    // FOOTER
    // ══════════════════════════════════════

    ws.getRow(row).height = 10;
    row++;

    // Delivery
    ws.mergeCells(`A${row}:K${row}`);
    const deliveryCell = ws.getCell(`A${row}`);
    deliveryCell.value = `Delivery: ${data.deliveryWeeks ? `${data.deliveryWeeks} weeks` : "As mutually agreed"} from the date of order confirmation`;
    deliveryCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "1E8449" } };
    deliveryCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_BG } };
    deliveryCell.alignment = { horizontal: "left", vertical: "middle" };
    deliveryCell.border = {
        top: { style: "thin" as BorderStyle, color: { argb: GREEN_BORDER } },
        bottom: { style: "thin" as BorderStyle, color: { argb: GREEN_BORDER } },
        left: { style: "medium" as BorderStyle, color: { argb: GREEN_BORDER } },
        right: { style: "thin" as BorderStyle, color: { argb: GREEN_BORDER } },
    };
    ws.getRow(row).height = 28;
    row++;

    // Signatory
    row += 2;
    ws.getCell(`A${row}`).value = "For " + company.name;
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10 };
    row += 3;

    ws.mergeCells(`A${row}:C${row}`);
    ws.getCell(`A${row}`).value = "________________________________";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10 };
    row++;

    ws.getCell(`A${row}`).value = "Authorized Signatory";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10, bold: true };
    row++;

    if (data.ownerName) {
        ws.getCell(`A${row}`).value = data.ownerName;
        ws.getCell(`A${row}`).font = { name: "Calibri", size: 9, color: { argb: "555555" } };
    }

    // Generate buffer
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
