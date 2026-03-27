import ExcelJS from "exceljs";
import { CompanyInfo } from "../shared/companyInfo";

interface HardnessEntry {
    hardnessType: string;
    value: string;
    measurement: string;
}

interface BomEntry {
    partName: string;
    material?: string;
    quantity: number;
    diameter?: string;
    length?: string;
    weight?: string;
    grade?: string;
    remarks?: string;
    hardness?: HardnessEntry[];
}

interface TechOfferItem {
    serialNumber: string;
    itemCode: string;
    itemName: string;
    itemDesc: string;
    itemType: string;
    quantity: number;
    drawingNumber: string;
    material: string;
    grade: string;
    hardness: HardnessEntry[];
    remarks: string;
    bom: BomEntry[];
    isRegret?: boolean;
    regretReason?: string;
}

interface TechOfferData {
    prNumber: string;
    companyName: string;
    location: string;
    ownerName: string;
    deliveryWeeks: number;
    items: TechOfferItem[];
}

// ── Colors ──
const NAVY = "0F2B46";
const GOLD = "D4A017";
const WHITE = "FFFFFF";
const LIGHT_BG = "F4F8FB";
const HEADER_FONT = "FFFFFF";
const BOM_HEADER_BG = "566573";
const BOM_LABEL_BG = "FEF9E7";
const GREEN_BG = "EAFAF1";
const GREEN_BORDER = "27AE60";
const BORDER_COLOR = "BDC3C7";

type BorderStyle = "thin" | "medium";

function thinBorder(): Partial<ExcelJS.Borders> {
    const side: Partial<ExcelJS.Border> = {
        style: "thin" as BorderStyle,
        color: { argb: BORDER_COLOR },
    };
    return { top: side, bottom: side, left: side, right: side };
}

function formatHardness(entries: HardnessEntry[]): string {
    if (!entries || entries.length === 0) return "—";
    return entries.map(h => `${h.hardnessType}: ${h.value} ${h.measurement}`).join("; ");
}

export async function generateTechOfferExcel(
    data: TechOfferData,
    company: CompanyInfo,
    logoBuffer?: Buffer | null
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.name;
    wb.created = new Date();

    const ws = wb.addWorksheet("Technical Offer", {
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    // Column widths
    ws.columns = [
        { width: 8 }, // A — Sl No
        { width: 14 }, // B — Item Code
        { width: 24 }, // C — Item Name
        { width: 14 }, // D — Drawing No
        { width: 20 }, // E — MOC & Grade
        { width: 26 }, // F — Hardness
        { width: 8 }, // G — Qty
        { width: 42 }, // H — Remarks
    ];

    let row = 1;

    // ══════════════════════════════════════
    // LETTERHEAD
    // ══════════════════════════════════════

    // Row 1: Company name (navy bg, white bold text)
    ws.mergeCells(`A${row}:H${row}`);
    const companyCell = ws.getCell(`A${row}`);
    companyCell.value = company.name;
    companyCell.font = { name: "Calibri", size: 18, bold: true, color: { argb: HEADER_FONT } };
    companyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    companyCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = 36;

    // Logo in header (right side)
    if (logoBuffer) {
        try {
            const imageId = wb.addImage({ buffer: logoBuffer, extension: "png" });
            ws.addImage(imageId, {
                tl: { col: 6.2, row: row - 1 + 0.1 } as unknown as ExcelJS.Anchor,
                br: { col: 7.8, row: row - 1 + 0.9 } as unknown as ExcelJS.Anchor,
            });
        } catch {
            // Ignore logo errors
        }
    }
    row++;

    // Row 2: Tagline (navy bg, lighter text)
    ws.mergeCells(`A${row}:H${row}`);
    const tagCell = ws.getCell(`A${row}`);
    tagCell.value = company.tagline || "";
    tagCell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "8FAABE" } };
    tagCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    tagCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = 20;
    row++;

    // Row 3: Gold accent strip
    ws.mergeCells(`A${row}:H${row}`);
    const goldCell = ws.getCell(`A${row}`);
    goldCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
    ws.getRow(row).height = 4;
    row++;

    // Row 4: Details — GSTIN | Vendor Code | Date
    ws.mergeCells(`A${row}:C${row}`);
    ws.getCell(`A${row}`).value = "GSTIN: " + (company.gstin || "\u2014");
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.mergeCells(`D${row}:E${row}`);
    ws.getCell(`D${row}`).value = "Vendor Code: " + (company.vendorCode || "\u2014");
    ws.getCell(`D${row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.mergeCells(`F${row}:H${row}`);
    ws.getCell(`F${row}`).value =
        `Date: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    ws.getCell(`F${row}`).font = { name: "Calibri", size: 9, bold: true };
    ws.getCell(`F${row}`).alignment = { horizontal: "right" };
    ws.getRow(row).height = 18;
    row++;

    // Row 5: Address
    ws.mergeCells(`A${row}:H${row}`);
    ws.getCell(`A${row}`).value =
        [company.address, company.phone ? `Ph: ${company.phone}` : ""]
            .filter(Boolean)
            .join("  |  ") || "\u2014";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 8, color: { argb: "555555" } };
    ws.getCell(`A${row}`).alignment = { horizontal: "center" };
    ws.getRow(row).height = 16;
    row++;

    // Row 6: Blank separator
    ws.getRow(row).height = 8;
    row++;

    // ══════════════════════════════════════
    // SUBJECT LINE
    // ══════════════════════════════════════
    ws.mergeCells(`A${row}:H${row}`);
    const subjectCell = ws.getCell(`A${row}`);
    subjectCell.value = `TECHNICAL OFFER — RFQ No: ${data.prNumber}`;
    subjectCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: NAVY } };
    subjectCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EAF2F8" } };
    subjectCell.alignment = { horizontal: "center", vertical: "middle" };
    subjectCell.border = thinBorder();
    ws.getRow(row).height = 28;
    row++;

    // Row: Company | Location
    ws.mergeCells(`A${row}:D${row}`);
    ws.getCell(`A${row}`).value = `Company: ${data.companyName}    |    Location: ${data.location}`;
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10 };
    ws.mergeCells(`E${row}:H${row}`);
    ws.getCell(`E${row}`).value = `Owner: ${data.ownerName}`;
    ws.getCell(`E${row}`).font = { name: "Calibri", size: 10 };
    ws.getCell(`E${row}`).alignment = { horizontal: "right" };
    ws.getRow(row).height = 20;
    row++;

    // Blank
    ws.getRow(row).height = 8;
    row++;

    // ══════════════════════════════════════
    // ITEMS TABLE HEADER
    // ══════════════════════════════════════
    const tableHeaders = [
        "Sl No.",
        "Item Code",
        "Item Name",
        "Drawing No.",
        "MOC & Grade",
        "Hardness",
        "Qty",
        "Remarks",
    ];
    const headerRow = ws.getRow(row);
    tableHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: HEADER_FONT } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder();
    });
    headerRow.height = 22;
    row++;

    // ══════════════════════════════════════
    // ITEMS
    // ══════════════════════════════════════
    data.items.forEach((item, idx) => {
        const mocGrade = [item.material, item.grade].filter(Boolean).join(" / ") || "—";
        const hardnessStr = formatHardness(item.hardness);
        const isEven = idx % 2 === 0;
        const bgColor = isEven ? LIGHT_BG : WHITE;

        const values = [
            item.serialNumber || String(idx + 1),
            item.itemCode,
            item.itemName,
            item.drawingNumber || "—",
            mocGrade,
            hardnessStr,
            item.quantity,
            item.remarks || "—",
        ];

        const dataRow = ws.getRow(row);
        values.forEach((v, i) => {
            const cell = dataRow.getCell(i + 1);
            cell.value = v;
            const isRegretRemarks = i === 7 && item.isRegret === true;
            cell.font = {
                name: "Calibri",
                size: 9,
                bold: i === 0 || isRegretRemarks,
                ...(isRegretRemarks ? { color: { argb: "C0392B" } } : {}),
            };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
            cell.alignment = {
                horizontal: i === 6 ? "center" : "left",
                vertical: "middle",
                wrapText: true,
            };
            cell.border = thinBorder();
        });
        dataRow.height = 20;
        row++;

        // BOM sub-table for SET/ASSEMBLY
        const isSetOrAssembly = item.itemType === "SET" || item.itemType === "ASSEMBLY";
        if (isSetOrAssembly && item.bom.length > 0) {
            // BOM label row
            ws.mergeCells(`A${row}:H${row}`);
            const bomLabel = ws.getCell(`A${row}`);
            bomLabel.value = `   ▸ BOM / Sub-Parts for: ${item.itemName}`;
            bomLabel.font = { name: "Calibri", size: 9, bold: true, italic: true };
            bomLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOM_LABEL_BG } };
            bomLabel.border = thinBorder();
            ws.getRow(row).height = 18;
            row++;

            // BOM header: #, Part Name, Material & Grade, Qty, Hardness, Remarks
            const bomHeaders = [
                "",
                "#",
                "Part Name",
                "Material & Grade",
                "Qty",
                "Hardness",
                "Remarks",
                "",
            ];
            const bomHeaderRow = ws.getRow(row);
            bomHeaders.forEach((h, i) => {
                const cell = bomHeaderRow.getCell(i + 1);
                cell.value = h;
                cell.font = { name: "Calibri", size: 9, bold: true, color: { argb: HEADER_FONT } };
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BOM_HEADER_BG } };
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                cell.border = thinBorder();
            });
            bomHeaderRow.height = 18;
            row++;

            // BOM data rows
            item.bom.forEach((part, pi) => {
                const matGrade = [part.material, part.grade].filter(Boolean).join(" / ") || "—";
                const partHardness = formatHardness(part.hardness ?? []);
                const bomBg = pi % 2 === 0 ? "FDFEFE" : "F2F4F4";

                const bomValues = [
                    "",
                    String(pi + 1),
                    part.partName,
                    matGrade,
                    part.quantity,
                    partHardness,
                    part.remarks || "—",
                    "",
                ];
                const bomRow = ws.getRow(row);
                bomValues.forEach((v, i) => {
                    const cell = bomRow.getCell(i + 1);
                    cell.value = v;
                    cell.font = { name: "Calibri", size: 8.5 };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bomBg } };
                    cell.alignment = {
                        horizontal: i === 4 ? "center" : "left",
                        vertical: "middle",
                        wrapText: true,
                    };
                    cell.border = thinBorder();
                });
                bomRow.height = 18;
                row++;
            });

            // Small gap after BOM
            ws.getRow(row).height = 4;
            row++;
        }
    });

    // ══════════════════════════════════════
    // FOOTER
    // ══════════════════════════════════════

    // Blank
    ws.getRow(row).height = 10;
    row++;

    // Delivery row
    ws.mergeCells(`A${row}:H${row}`);
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

    // Blank rows
    row += 2;

    // Signatory
    ws.getCell(`A${row}`).value = "For " + company.name;
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10 };
    row += 3;

    ws.mergeCells(`A${row}:C${row}`);
    const sigLine = ws.getCell(`A${row}`);
    sigLine.value = "________________________________";
    sigLine.font = { name: "Calibri", size: 10 };
    row++;

    ws.getCell(`A${row}`).value = "Authorized Signatory";
    ws.getCell(`A${row}`).font = { name: "Calibri", size: 10, bold: true };
    row++;

    if (company.contactPersonName) {
        ws.getCell(`A${row}`).value = company.contactPersonName;
        ws.getCell(`A${row}`).font = { name: "Calibri", size: 9, bold: true };
        row++;
    }
    if (company.contactPersonPhone) {
        ws.getCell(`A${row}`).value = `Ph: ${company.contactPersonPhone}`;
        ws.getCell(`A${row}`).font = { name: "Calibri", size: 9, color: { argb: "555555" } };
        row++;
    }
    if (!company.contactPersonName && data.ownerName) {
        ws.getCell(`A${row}`).value = data.ownerName;
        ws.getCell(`A${row}`).font = { name: "Calibri", size: 9, color: { argb: "555555" } };
    }

    // Generate buffer
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
