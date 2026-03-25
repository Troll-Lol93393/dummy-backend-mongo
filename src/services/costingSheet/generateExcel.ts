import ExcelJS from "exceljs";
import { CostingSheetData } from "./generatePdf";
import { CompanyInfo } from "../shared/companyInfo";

// ── Colors ──
const NAVY = "0F2B46";
const GOLD = "D4A017";
const WHITE = "FFFFFF";
const LIGHT_BLUE = "EAF2F8";
const VERY_LIGHT_BLUE = "F7FAFD";
const HEADER_FONT = "FFFFFF";
const BORDER_CLR = "D5DDE5";
const BORDER_DARK = "AAB7C4";
const TEXT_MUTED = "64748B";
const TEXT_DARK = "1A202C";
const MANUAL_BG = "F0FDF4";
const MANUAL_ACCENT = "16A34A";
const SUPPLY_BG = "EFF6FF";
const SUPPLY_ACCENT = "2563EB";
const LABOUR_HEADER = "334155";
const LABOUR_EVEN = "F8FAFC";
const LABOUR_ODD = "F1F5F9";
const PRICING_BG = "FEFCE8";
const PRICING_BORDER = "FBBF24";
const SUMMARY_BG = "FFFBEB";
const SUMMARY_BORDER = "D97706";
const GREEN_BG = "ECFDF5";
const GREEN_BORDER = "059669";
const GREEN_TEXT = "065F46";

type BS = "thin" | "medium";

function thinBorder(color = BORDER_CLR): Partial<ExcelJS.Borders> {
    const s: Partial<ExcelJS.Border> = { style: "thin" as BS, color: { argb: color } };
    return { top: s, bottom: s, left: s, right: s };
}

function fc(val: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    }).format(val);
}

function partyName(ref: unknown): string {
    if (!ref) return "—";
    if (typeof ref === "string") return ref;
    return (ref as { acName?: string }).acName || "—";
}

function labourName(ref: unknown): string {
    if (!ref) return "—";
    if (typeof ref === "string") return ref;
    return (ref as { name?: string }).name || "—";
}

function applyRow(
    ws: ExcelJS.Worksheet,
    row: number,
    cols: number,
    fill: string,
    border = BORDER_CLR
) {
    for (let c = 1; c <= cols; c++) {
        const cell = ws.getRow(row).getCell(c);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.border = thinBorder(border);
    }
}

function setCell(
    ws: ExcelJS.Worksheet,
    row: number,
    col: number,
    value: string | number,
    opts: {
        bold?: boolean;
        size?: number;
        color?: string;
        bg?: string;
        align?: "left" | "center" | "right";
        border?: string;
    } = {}
) {
    const cell = ws.getRow(row).getCell(col);
    cell.value = value;
    cell.font = {
        name: "Calibri",
        size: opts.size ?? 9,
        bold: opts.bold ?? false,
        color: { argb: opts.color ?? TEXT_DARK },
    };
    if (opts.align) cell.alignment = { horizontal: opts.align, vertical: "middle" };
    if (opts.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.bg } };
    if (opts.border) cell.border = thinBorder(opts.border);
}

const COLS = 12; // A through L

export async function generateCostingSheetExcel(
    data: CostingSheetData,
    company: CompanyInfo,
    logoBuffer?: Buffer | null
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.name;
    wb.created = new Date();

    const ws = wb.addWorksheet("Costing Sheet", {
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    // Column widths — 12 columns
    ws.columns = [
        { width: 4 }, // A — spacer / #
        { width: 14 }, // B — Label / Process
        { width: 16 }, // C — Value / Party
        { width: 14 }, // D — Label / Rate
        { width: 14 }, // E — Value / Rate Type
        { width: 14 }, // F — Label / Cost
        { width: 14 }, // G — Value
        { width: 14 }, // H — Label
        { width: 14 }, // I — Value
        { width: 14 }, // J — Label
        { width: 14 }, // K — Value
        { width: 6 }, // L — spacer
    ];

    let row = 1;

    // ══════════════════════════════════════
    // HEADER
    // ══════════════════════════════════════

    // Company title
    ws.mergeCells(`A${row}:L${row}`);
    const titleCell = ws.getCell(`A${row}`);
    titleCell.value = company.name;
    titleCell.font = { name: "Calibri", size: 18, bold: true, color: { argb: HEADER_FONT } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = 34;

    // Logo in header (right side)
    if (logoBuffer) {
        try {
            const imageId = wb.addImage({ buffer: logoBuffer, extension: "png" });
            ws.addImage(imageId, {
                tl: { col: 10.2, row: row - 1 + 0.1 } as unknown as ExcelJS.Anchor,
                br: { col: 11.8, row: row - 1 + 0.9 } as unknown as ExcelJS.Anchor,
            });
        } catch {
            // Ignore logo errors
        }
    }
    row++;

    // Tagline
    ws.mergeCells(`A${row}:L${row}`);
    const tagCell = ws.getCell(`A${row}`);
    tagCell.value = company.tagline || "Internal Costing Reference Sheet";
    tagCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "7FAABE" } };
    tagCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    tagCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = 18;
    row++;

    // Gold accent
    ws.mergeCells(`A${row}:L${row}`);
    ws.getCell(`A${row}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: GOLD },
    };
    ws.getRow(row).height = 3;
    row++;

    // Info bar — RFQ | Company | Location | Date
    const infoLabels = ["RFQ Number", "Company", "Location", "Date"];
    const infoValues = [data.prNumber, data.companyName, data.location, data.generatedDate];
    // Labels row
    const labelCols = [
        ["A", "C"],
        ["D", "F"],
        ["G", "I"],
        ["J", "L"],
    ];
    labelCols.forEach(([start, end], i) => {
        ws.mergeCells(`${start}${row}:${end}${row}`);
        const cell = ws.getCell(`${start}${row}`);
        cell.value = infoLabels[i]!;
        cell.font = { name: "Calibri", size: 7, color: { argb: TEXT_MUTED } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
        cell.alignment = { vertical: "middle" };
        cell.border = thinBorder(BORDER_DARK);
    });
    ws.getRow(row).height = 14;
    row++;

    // Values row
    labelCols.forEach(([start, end], i) => {
        ws.mergeCells(`${start}${row}:${end}${row}`);
        const cell = ws.getCell(`${start}${row}`);
        cell.value = infoValues[i]!;
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
        cell.alignment = { vertical: "middle" };
        cell.border = thinBorder(BORDER_DARK);
    });
    ws.getRow(row).height = 20;
    row++;

    row++; // blank separator

    // ══════════════════════════════════════
    // ITEMS
    // ══════════════════════════════════════
    for (let idx = 0; idx < data.items.length; idx++) {
        const item = data.items[idx]!;

        // ── Item Header ──
        ws.mergeCells(`A${row}:L${row}`);
        const ih = ws.getCell(`A${row}`);
        ih.value = `  ${idx + 1}.  ${item.itemCode} — ${item.itemName}          Type: ${item.itemType}   |   Qty: ${item.quantity}`;
        ih.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_FONT } };
        ih.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        ih.alignment = { vertical: "middle" };
        ih.border = thinBorder(NAVY);
        ws.getRow(row).height = 26;
        row++;

        // ── Parts ──
        for (let pi = 0; pi < item.parts.length; pi++) {
            const part = item.parts[pi]!;
            const isManual = part.supplyType === "MANUAL";
            const accent = isManual ? MANUAL_ACCENT : SUPPLY_ACCENT;
            const partBg = isManual ? MANUAL_BG : SUPPLY_BG;

            // Part header
            ws.mergeCells(`A${row}:L${row}`);
            const ph = ws.getCell(`A${row}`);
            ph.value = `     Part ${pi + 1}: ${part.partName}          Qty: ${part.quantity}   |   ${isManual ? "Manual Costing" : "Complete Supply"}`;
            ph.font = { name: "Calibri", size: 9, bold: true, color: { argb: TEXT_DARK } };
            ph.fill = { type: "pattern", pattern: "solid", fgColor: { argb: partBg } };
            ph.border = thinBorder(accent);
            ws.getRow(row).height = 20;
            row++;

            if (isManual) {
                // ── Raw Material Grid (labels + values in 2 rows) ──
                const dims = buildDims(part);
                const rmLabels = [
                    "Shape",
                    "Dimensions",
                    "Weight",
                    "Rate/kg",
                    "RM Cost",
                    "RM Party",
                ];
                const rmValues = [
                    part.shapeType ?? "—",
                    dims,
                    `${(part.weight ?? 0).toFixed(3)} kg`,
                    fc(part.materialRate ?? 0),
                    fc(part.rawMaterialCost ?? 0),
                    partyName(part.rawMaterialParty),
                ];
                const rmCols = [
                    ["A", "B"],
                    ["C", "D"],
                    ["E", "F"],
                    ["G", "H"],
                    ["I", "J"],
                    ["K", "L"],
                ];

                // Label row
                rmCols.forEach(([start, end], i) => {
                    ws.mergeCells(`${start}${row}:${end}${row}`);
                    const cell = ws.getCell(`${start}${row}`);
                    cell.value = rmLabels[i]!;
                    cell.font = {
                        name: "Calibri",
                        size: 7,
                        bold: true,
                        color: { argb: TEXT_MUTED },
                    };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: VERY_LIGHT_BLUE },
                    };
                    cell.alignment = { vertical: "middle" };
                    cell.border = thinBorder();
                });
                ws.getRow(row).height = 14;
                row++;

                // Value row
                rmCols.forEach(([start, end], i) => {
                    ws.mergeCells(`${start}${row}:${end}${row}`);
                    const cell = ws.getCell(`${start}${row}`);
                    cell.value = rmValues[i]!;
                    cell.font = {
                        name: "Calibri",
                        size: 9,
                        bold: i === 4,
                        color: { argb: TEXT_DARK },
                    };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: VERY_LIGHT_BLUE },
                    };
                    cell.alignment = { vertical: "middle" };
                    cell.border = thinBorder();
                });
                ws.getRow(row).height = 18;
                row++;

                // ── Labour Entries ──
                const labours = part.labourEntries ?? [];
                if (labours.length > 0) {
                    // Labour header
                    const lhLabels = [
                        "#",
                        "Process",
                        "",
                        "Party",
                        "",
                        "Rate",
                        "Rate Type",
                        "",
                        "Cost",
                        "",
                        "",
                        "",
                    ];
                    const lhRow = ws.getRow(row);
                    // Merge some cols for header
                    ws.mergeCells(`B${row}:C${row}`);
                    ws.mergeCells(`D${row}:E${row}`);
                    ws.mergeCells(`I${row}:J${row}`);

                    const headerVals = [
                        "#",
                        "Process",
                        "",
                        "Party",
                        "",
                        "Rate",
                        "Rate Type",
                        "",
                        "Cost",
                    ];
                    const headerPositions = [1, 2, -1, 4, -1, 6, 7, -1, 9];
                    headerPositions.forEach((col, i) => {
                        if (col === -1) return;
                        const cell = lhRow.getCell(col);
                        cell.value = headerVals[i]!;
                        cell.font = {
                            name: "Calibri",
                            size: 8,
                            bold: true,
                            color: { argb: HEADER_FONT },
                        };
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: LABOUR_HEADER },
                        };
                        cell.alignment = {
                            horizontal: col === 1 || col >= 6 ? "center" : "left",
                            vertical: "middle",
                        };
                        cell.border = thinBorder(LABOUR_HEADER);
                    });
                    // Fill remaining cols
                    for (const c of [3, 5, 8, 10, 11, 12]) {
                        const cell = lhRow.getCell(c);
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: LABOUR_HEADER },
                        };
                        cell.border = thinBorder(LABOUR_HEADER);
                    }
                    ws.getRow(row).height = 18;
                    row++;

                    // Labour data rows
                    labours.forEach((le, li) => {
                        const rowBg = li % 2 === 0 ? LABOUR_EVEN : LABOUR_ODD;

                        ws.mergeCells(`B${row}:C${row}`);
                        ws.mergeCells(`D${row}:E${row}`);
                        ws.mergeCells(`I${row}:J${row}`);

                        setCell(ws, row, 1, String(li + 1), {
                            size: 8,
                            align: "center",
                            bg: rowBg,
                            border: BORDER_CLR,
                        });
                        setCell(ws, row, 2, labourName(le.labourProcessType), {
                            size: 8,
                            bg: rowBg,
                            border: BORDER_CLR,
                        });
                        setCell(ws, row, 4, partyName(le.party), {
                            size: 8,
                            bg: rowBg,
                            border: BORDER_CLR,
                        });
                        setCell(ws, row, 6, fc(le.rate), {
                            size: 8,
                            align: "center",
                            bg: rowBg,
                            border: BORDER_CLR,
                        });
                        setCell(ws, row, 7, le.rateType === "PER_KG" ? "Per Kg" : "Per Piece", {
                            size: 8,
                            align: "center",
                            bg: rowBg,
                            border: BORDER_CLR,
                        });
                        setCell(ws, row, 9, fc(le.cost), {
                            size: 8,
                            bold: true,
                            align: "center",
                            bg: rowBg,
                            border: BORDER_CLR,
                        });
                        // Fill remaining cells
                        for (const c of [3, 5, 8, 10, 11, 12]) {
                            const cell = ws.getRow(row).getCell(c);
                            if (
                                !cell.fill ||
                                (cell.fill as ExcelJS.FillPattern).fgColor === undefined
                            ) {
                                cell.fill = {
                                    type: "pattern",
                                    pattern: "solid",
                                    fgColor: { argb: rowBg },
                                };
                            }
                            cell.border = thinBorder();
                        }
                        ws.getRow(row).height = 16;
                        row++;
                    });

                    // Labour total
                    ws.mergeCells(`A${row}:H${row}`);
                    ws.mergeCells(`I${row}:J${row}`);
                    setCell(ws, row, 1, "Total Labour Cost", {
                        size: 9,
                        bold: true,
                        align: "right",
                        bg: LABOUR_ODD,
                        border: BORDER_DARK,
                    });
                    setCell(ws, row, 9, fc(part.totalLabourCost ?? 0), {
                        size: 9,
                        bold: true,
                        align: "center",
                        bg: LABOUR_ODD,
                        border: BORDER_DARK,
                    });
                    for (const c of [10, 11, 12]) {
                        const cell = ws.getRow(row).getCell(c);
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: LABOUR_ODD },
                        };
                        cell.border = thinBorder(BORDER_DARK);
                    }
                    ws.getRow(row).height = 18;
                    row++;
                }
            } else {
                // ── Complete Supply Grid ──
                const dateStr = part.completeSupplyDate
                    ? new Date(part.completeSupplyDate).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                      })
                    : "—";
                const csCols = [
                    ["A", "D"],
                    ["E", "H"],
                    ["I", "L"],
                ];
                const csLabels = ["Rate / pc", "Party", "Date"];
                const csValues = [
                    fc(part.completeSupplyRate ?? 0),
                    partyName(part.completeSupplyParty),
                    dateStr,
                ];

                // Labels
                csCols.forEach(([start, end], i) => {
                    ws.mergeCells(`${start}${row}:${end}${row}`);
                    const cell = ws.getCell(`${start}${row}`);
                    cell.value = csLabels[i]!;
                    cell.font = {
                        name: "Calibri",
                        size: 7,
                        bold: true,
                        color: { argb: TEXT_MUTED },
                    };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: SUPPLY_BG },
                    };
                    cell.alignment = { vertical: "middle" };
                    cell.border = thinBorder(SUPPLY_ACCENT);
                });
                ws.getRow(row).height = 14;
                row++;

                // Values
                csCols.forEach(([start, end], i) => {
                    ws.mergeCells(`${start}${row}:${end}${row}`);
                    const cell = ws.getCell(`${start}${row}`);
                    cell.value = csValues[i]!;
                    cell.font = {
                        name: "Calibri",
                        size: 10,
                        bold: true,
                        color: { argb: TEXT_DARK },
                    };
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: SUPPLY_BG },
                    };
                    cell.alignment = { vertical: "middle" };
                    cell.border = thinBorder(SUPPLY_ACCENT);
                });
                ws.getRow(row).height = 20;
                row++;
            }

            // ── Part Pricing Row ──
            const pricingLabels = ["Cost Price", "Margin", "Profit", "Part Total"];
            const pricingValues = [
                fc(part.costPrice ?? 0),
                `${(part.profitMargin ?? 0).toFixed(1)}%`,
                fc(part.profitAmount ?? 0),
                fc(part.partTotal ?? 0),
            ];
            const pricingCols = [
                ["A", "C"],
                ["D", "F"],
                ["G", "I"],
                ["J", "L"],
            ];

            // Labels
            pricingCols.forEach(([start, end], i) => {
                ws.mergeCells(`${start}${row}:${end}${row}`);
                const cell = ws.getCell(`${start}${row}`);
                cell.value = pricingLabels[i]!;
                cell.font = { name: "Calibri", size: 7, color: { argb: TEXT_MUTED } };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: PRICING_BG },
                };
                cell.alignment = { vertical: "middle" };
                cell.border = thinBorder(PRICING_BORDER);
            });
            ws.getRow(row).height = 13;
            row++;

            // Values
            pricingCols.forEach(([start, end], i) => {
                ws.mergeCells(`${start}${row}:${end}${row}`);
                const cell = ws.getCell(`${start}${row}`);
                cell.value = pricingValues[i]!;
                cell.font = {
                    name: "Calibri",
                    size: i === 3 ? 11 : 10,
                    bold: true,
                    color: { argb: i === 3 ? SUMMARY_BORDER : TEXT_DARK },
                };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: PRICING_BG },
                };
                cell.alignment = { vertical: "middle" };
                cell.border = thinBorder(PRICING_BORDER);
            });
            ws.getRow(row).height = 20;
            row++;
        }

        // ── Item Summary ──
        const summaryLabels = [
            "Parts Total",
            "Packing",
            "Shipping",
            "Selling Price/pc",
            "Total Cost",
        ];
        const summaryValues = [
            fc(item.totalPartsCost),
            fc(item.packingCost),
            fc(item.shippingCost),
            fc(item.sellingPrice),
            fc(item.totalCost),
        ];

        // Label row
        ws.mergeCells(`A${row}:B${row}`);
        setCell(ws, row, 1, summaryLabels[0]!, {
            size: 7,
            color: TEXT_MUTED,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`C${row}:D${row}`);
        setCell(ws, row, 3, summaryLabels[1]!, {
            size: 7,
            color: TEXT_MUTED,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`E${row}:F${row}`);
        setCell(ws, row, 5, summaryLabels[2]!, {
            size: 7,
            color: TEXT_MUTED,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`G${row}:H${row}`);
        setCell(ws, row, 7, summaryLabels[3]!, {
            size: 7,
            color: TEXT_MUTED,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`I${row}:L${row}`);
        setCell(ws, row, 9, summaryLabels[4]!, {
            size: 7,
            color: TEXT_MUTED,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.getRow(row).height = 13;
        row++;

        // Value row
        ws.mergeCells(`A${row}:B${row}`);
        setCell(ws, row, 1, summaryValues[0]!, {
            size: 10,
            bold: true,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`C${row}:D${row}`);
        setCell(ws, row, 3, summaryValues[1]!, {
            size: 10,
            bold: true,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`E${row}:F${row}`);
        setCell(ws, row, 5, summaryValues[2]!, {
            size: 10,
            bold: true,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`G${row}:H${row}`);
        setCell(ws, row, 7, summaryValues[3]!, {
            size: 10,
            bold: true,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.mergeCells(`I${row}:L${row}`);
        setCell(ws, row, 9, summaryValues[4]!, {
            size: 12,
            bold: true,
            color: SUMMARY_BORDER,
            bg: SUMMARY_BG,
            border: SUMMARY_BORDER,
        });
        ws.getRow(row).height = 22;
        row++;

        row++; // spacing between items
    }

    // ══════════════════════════════════════
    // GRAND TOTAL
    // ══════════════════════════════════════
    ws.mergeCells(`A${row}:L${row}`);
    const gtLabelCell = ws.getCell(`A${row}`);
    gtLabelCell.value = "Grand Total";
    gtLabelCell.font = { name: "Calibri", size: 9, color: { argb: GREEN_TEXT } };
    gtLabelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_BG } };
    gtLabelCell.border = thinBorder(GREEN_BORDER);
    gtLabelCell.alignment = { vertical: "middle" };
    ws.getRow(row).height = 14;
    row++;

    ws.mergeCells(`A${row}:L${row}`);
    const gtCell = ws.getCell(`A${row}`);
    gtCell.value = `${fc(data.grandTotal)}          (${data.items.length} items)`;
    gtCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: GREEN_TEXT } };
    gtCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_BG } };
    gtCell.border = thinBorder(GREEN_BORDER);
    gtCell.alignment = { vertical: "middle" };
    ws.getRow(row).height = 30;
    row++;

    // Footer
    row++;
    ws.mergeCells(`A${row}:L${row}`);
    ws.getCell(`A${row}`).value = "Internal costing reference — not for external distribution.";
    ws.getCell(`A${row}`).font = {
        name: "Calibri",
        size: 8,
        italic: true,
        color: { argb: "999999" },
    };

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function buildDims(part: {
    diameter?: number;
    width?: number;
    thickness?: number;
    innerDiameter?: number;
    length?: number;
}): string {
    const dims: string[] = [];
    if (part.diameter && part.diameter > 0) dims.push(`Dia ${part.diameter}`);
    if (part.width && part.width > 0) dims.push(`W ${part.width}`);
    if (part.thickness && part.thickness > 0) dims.push(`T ${part.thickness}`);
    if (part.innerDiameter && part.innerDiameter > 0) dims.push(`ID ${part.innerDiameter}`);
    if (part.length && part.length > 0) dims.push(`L ${part.length}`);
    return dims.length > 0 ? dims.join(" x ") + " mm" : "—";
}
