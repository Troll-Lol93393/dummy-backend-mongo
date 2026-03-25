import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { CompanyInfo } from "../shared/companyInfo";

interface PartyRef {
    _id?: string;
    acName?: string;
}

interface LabourProcessRef {
    _id?: string;
    name?: string;
}

interface LabourEntry {
    labourProcessType: LabourProcessRef | string;
    party?: PartyRef | string;
    rate: number;
    rateType: "PER_PIECE" | "PER_KG";
    cost: number;
}

interface CostingPart {
    partName: string;
    quantity: number;
    supplyType: "MANUAL" | "COMPLETE_SUPPLY";
    shapeType?: string;
    diameter?: number;
    width?: number;
    thickness?: number;
    innerDiameter?: number;
    length?: number;
    density?: number;
    weight?: number;
    materialRate?: number;
    rawMaterialParty?: PartyRef | string;
    rawMaterialCost?: number;
    labourEntries?: LabourEntry[];
    totalLabourCost?: number;
    completeSupplyRate?: number;
    completeSupplyParty?: PartyRef | string;
    completeSupplyDate?: string;
    costPrice?: number;
    profitMargin?: number;
    profitAmount?: number;
    partTotal?: number;
}

interface CostingItem {
    serialNumber: string;
    itemCode: string;
    itemName: string;
    itemType: string;
    quantity: number;
    parts: CostingPart[];
    totalPartsCost: number;
    packingCost: number;
    shippingCost: number;
    otherCosts: number;
    sellingPrice: number;
    totalCost: number;
}

export interface CostingSheetData {
    prNumber: string;
    companyName: string;
    location: string;
    generatedDate: string;
    items: CostingItem[];
    grandTotal: number;
}

// ── Colors ──
const C = {
    navy: "#0f2b46",
    navyLight: "#1a3d5c",
    gold: "#d4a017",
    white: "#ffffff",
    headerText: "#ffffff",
    lightBlue: "#eaf2f8",
    veryLightBlue: "#f7fafd",
    border: "#d5dde5",
    borderDark: "#aab7c4",
    textDark: "#1a202c",
    textMuted: "#64748b",
    textLabel: "#475569",
    manualBg: "#f0fdf4",
    manualAccent: "#16a34a",
    supplyBg: "#eff6ff",
    supplyAccent: "#2563eb",
    labourHeaderBg: "#334155",
    labourRowEven: "#f8fafc",
    labourRowOdd: "#f1f5f9",
    pricingBg: "#fefce8",
    pricingBorder: "#fbbf24",
    summaryBg: "#fffbeb",
    summaryBorder: "#d97706",
    greenBg: "#ecfdf5",
    greenBorder: "#059669",
    greenText: "#065f46",
};

function mg(doc: PDFKit.PDFDocument) {
    const m = doc.page.margins!;
    return { left: m.left!, right: m.right!, top: m.top!, bottom: m.bottom! };
}

function pw(doc: PDFKit.PDFDocument) {
    return doc.page.width - mg(doc).left - mg(doc).right;
}

function fc(val: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    }).format(val);
}

function checkPageBreak(doc: PDFKit.PDFDocument, needed: number) {
    if (doc.y + needed > doc.page.height - mg(doc).bottom - 20) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, 3).fill(C.navy);
        doc.rect(0, 3, doc.page.width, 1.5).fill(C.gold);
        doc.y = mg(doc).top + 8;
    }
}

function partyName(ref: PartyRef | string | undefined): string {
    if (!ref) return "—";
    if (typeof ref === "string") return ref;
    return ref.acName || "—";
}

function labourName(ref: LabourProcessRef | string | undefined): string {
    if (!ref) return "—";
    if (typeof ref === "string") return ref;
    return ref.name || "—";
}

// ── Draw bordered cell ──
function drawCell(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    opts: {
        bg?: string;
        fontColor?: string;
        fontSize?: number;
        bold?: boolean;
        align?: "left" | "center" | "right";
        border?: boolean;
        borderColor?: string;
        paddingX?: number;
    } = {}
) {
    const {
        bg,
        fontColor = C.textDark,
        fontSize = 7.5,
        bold = false,
        align = "left",
        border = true,
        borderColor = C.border,
        paddingX = 4,
    } = opts;

    if (bg) doc.rect(x, y, w, h).fill(bg);
    if (border) {
        doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(borderColor).stroke();
    }

    doc.font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fontSize)
        .fillColor(fontColor)
        .text(text, x + paddingX, y + (h - fontSize) / 2, {
            width: w - paddingX * 2,
            align,
            lineBreak: false,
        });
}

// ── Draw label:value pair cell ──
function drawKVCell(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    opts: { bg?: string; borderColor?: string } = {}
) {
    const { bg = C.veryLightBlue, borderColor = C.border } = opts;
    doc.rect(x, y, w, h).fill(bg);
    doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(borderColor).stroke();

    doc.font("Helvetica")
        .fontSize(6)
        .fillColor(C.textMuted)
        .text(label, x + 5, y + 3, { width: w - 10, lineBreak: false });
    doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(C.textDark)
        .text(value, x + 5, y + 12, { width: w - 10, lineBreak: false });
}

export function generateCostingSheetPdf(data: CostingSheetData, company: CompanyInfo): PassThrough {
    const stream = new PassThrough();
    const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
    doc.pipe(stream);

    drawHeader(doc, data, company);

    data.items.forEach((item, idx) => {
        drawItemSection(doc, item, idx);
    });

    drawGrandTotal(doc, data);
    drawFooter(doc);

    doc.end();
    return stream;
}

function drawHeader(doc: PDFKit.PDFDocument, data: CostingSheetData, company: CompanyInfo) {
    const pageWidth = pw(doc);
    const x = mg(doc).left;

    // Top accent bars
    doc.rect(0, 0, doc.page.width, 5).fill(C.navy);
    doc.rect(0, 5, doc.page.width, 2).fill(C.gold);

    // Company header block
    const hY = 14;
    doc.rect(x, hY, pageWidth, 50).fill(C.navy);
    doc.rect(x, hY, 4, 50).fill(C.gold);

    doc.font("Helvetica-Bold")
        .fontSize(20)
        .fillColor(C.headerText)
        .text(company.name, x + 18, hY + 8, { width: pageWidth - 36 });
    doc.font("Helvetica")
        .fontSize(9)
        .fillColor("#7faabe")
        .text("Internal Costing Reference Sheet", x + 18, hY + 32, {
            width: pageWidth - 36,
        });

    // RFQ info bar
    const sY = hY + 56;
    doc.rect(x, sY, pageWidth, 30).fill(C.lightBlue);
    doc.rect(x, sY, pageWidth, 30).lineWidth(0.5).strokeColor(C.borderDark).stroke();
    doc.rect(x, sY, 3, 30).fill(C.gold);

    const infoColW = pageWidth / 4;
    const infoPairs = [
        ["RFQ Number", data.prNumber],
        ["Company", data.companyName],
        ["Location", data.location],
        ["Date", data.generatedDate],
    ];
    infoPairs.forEach(([label, val], i) => {
        const cx = x + infoColW * i + 14;
        doc.font("Helvetica")
            .fontSize(6.5)
            .fillColor(C.textMuted)
            .text(label!, cx, sY + 5, {
                width: infoColW - 20,
                lineBreak: false,
            });
        doc.font("Helvetica-Bold")
            .fontSize(9)
            .fillColor(C.navy)
            .text(val!, cx, sY + 15, {
                width: infoColW - 20,
                lineBreak: false,
            });
    });

    doc.y = sY + 38;
}

function drawItemSection(doc: PDFKit.PDFDocument, item: CostingItem, idx: number) {
    const pageWidth = pw(doc);
    const x = mg(doc).left;

    checkPageBreak(doc, 90);

    // ── Item Header ──
    const ihY = doc.y;
    doc.rect(x, ihY, pageWidth, 24).fill(C.navy);
    doc.rect(x, ihY, pageWidth, 24).lineWidth(0.5).strokeColor(C.navyLight).stroke();

    // Item number circle
    doc.circle(x + 16, ihY + 12, 9).fill(C.gold);
    doc.font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(C.navy)
        .text(String(idx + 1), x + 10, ihY + 8, { width: 12, align: "center" });

    doc.font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(C.headerText)
        .text(`${item.itemCode} — ${item.itemName}`, x + 32, ihY + 4, {
            width: pageWidth - 220,
            lineBreak: false,
        });
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor("#8faabe")
        .text(`Type: ${item.itemType}   |   Qty: ${item.quantity}`, x + pageWidth - 180, ihY + 7, {
            width: 170,
            align: "right",
            lineBreak: false,
        });

    doc.y = ihY + 28;

    // Parts
    item.parts.forEach((part, pi) => {
        drawPartSection(doc, part, pi, x, pageWidth);
    });

    // ── Item Summary Row ──
    checkPageBreak(doc, 44);
    const tY = doc.y + 3;
    doc.rect(x, tY, pageWidth, 38).fill(C.summaryBg);
    doc.rect(x, tY, pageWidth, 38).lineWidth(0.7).strokeColor(C.summaryBorder).stroke();
    doc.rect(x, tY, 3, 38).fill(C.summaryBorder);

    const col = pageWidth / 5;
    const pairs: [string, number][] = [
        ["Parts Total", item.totalPartsCost],
        ["Packing", item.packingCost],
        ["Shipping", item.shippingCost],
        ["Selling Price / pc", item.sellingPrice],
        ["Total Cost", item.totalCost],
    ];
    pairs.forEach(([label, val], i) => {
        const cx = x + col * i + 10;
        doc.font("Helvetica")
            .fontSize(6.5)
            .fillColor(C.textMuted)
            .text(label, cx, tY + 5, {
                width: col - 20,
                lineBreak: false,
            });
        const isTotal = i === 4;
        doc.font("Helvetica-Bold")
            .fontSize(isTotal ? 10 : 9)
            .fillColor(isTotal ? C.summaryBorder : C.textDark)
            .text(fc(val), cx, tY + 18, { width: col - 20, lineBreak: false });
    });

    doc.y = tY + 46;
}

function drawPartSection(
    doc: PDFKit.PDFDocument,
    part: CostingPart,
    pi: number,
    x: number,
    pageWidth: number
) {
    const isManual = part.supplyType === "MANUAL";
    const accent = isManual ? C.manualAccent : C.supplyAccent;
    const bg = isManual ? C.manualBg : C.supplyBg;

    checkPageBreak(doc, 70);

    // ── Part Header ──
    let y = doc.y;
    doc.rect(x + 8, y, pageWidth - 16, 18).fill(bg);
    doc.rect(x + 8, y, pageWidth - 16, 18)
        .lineWidth(0.5)
        .strokeColor(accent)
        .stroke();
    doc.rect(x + 8, y, 3, 18).fill(accent);

    doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(C.textDark)
        .text(`Part ${pi + 1}: ${part.partName}`, x + 18, y + 4, {
            width: pageWidth - 250,
            lineBreak: false,
        });

    doc.font("Helvetica")
        .fontSize(7)
        .fillColor(C.textLabel)
        .text(
            `Qty: ${part.quantity}   |   ${isManual ? "Manual Costing" : "Complete Supply"}`,
            x + pageWidth - 230,
            y + 5,
            { width: 210, align: "right", lineBreak: false }
        );

    y += 20;
    doc.y = y;

    if (isManual) {
        drawManualDetails(doc, part, x, pageWidth);
    } else {
        drawCompleteSupplyDetails(doc, part, x, pageWidth);
    }

    // ── Part Pricing Row ──
    checkPageBreak(doc, 26);
    y = doc.y;
    const pricingW = (pageWidth - 16) / 4;
    doc.rect(x + 8, y, pageWidth - 16, 24).fill(C.pricingBg);
    doc.rect(x + 8, y, pageWidth - 16, 24)
        .lineWidth(0.5)
        .strokeColor(C.pricingBorder)
        .stroke();

    const pricingPairs: [string, string][] = [
        ["Cost Price", fc(part.costPrice ?? 0)],
        ["Margin", `${(part.profitMargin ?? 0).toFixed(1)}%`],
        ["Profit", fc(part.profitAmount ?? 0)],
        ["Part Total", fc(part.partTotal ?? 0)],
    ];
    pricingPairs.forEach(([label, val], i) => {
        const cx = x + 8 + pricingW * i + 8;
        doc.font("Helvetica")
            .fontSize(6)
            .fillColor(C.textMuted)
            .text(label, cx, y + 3, {
                width: pricingW - 16,
                lineBreak: false,
            });
        const isPartTotal = i === 3;
        doc.font("Helvetica-Bold")
            .fontSize(isPartTotal ? 9 : 8)
            .fillColor(isPartTotal ? C.summaryBorder : C.textDark)
            .text(val, cx, y + 12, { width: pricingW - 16, lineBreak: false });
    });
    doc.y = y + 28;
}

function drawManualDetails(
    doc: PDFKit.PDFDocument,
    part: CostingPart,
    x: number,
    pageWidth: number
) {
    checkPageBreak(doc, 50);
    let y = doc.y;

    // ── Raw Material Grid ──
    const rmW = (pageWidth - 16) / 6;
    const rmH = 24;
    const dims = buildDimensionStr(part);

    const rmCells: [string, string][] = [
        ["Shape", part.shapeType ?? "—"],
        ["Dimensions", dims],
        ["Weight", `${(part.weight ?? 0).toFixed(3)} kg`],
        ["Rate / kg", fc(part.materialRate ?? 0)],
        ["RM Cost", fc(part.rawMaterialCost ?? 0)],
        ["RM Party", partyName(part.rawMaterialParty)],
    ];

    rmCells.forEach(([label, val], i) => {
        drawKVCell(doc, x + 8 + rmW * i, y, rmW, rmH, label, val);
    });
    y += rmH;
    doc.y = y;

    // ── Labour Entries ──
    const labours = part.labourEntries ?? [];
    if (labours.length > 0) {
        checkPageBreak(doc, 16 + labours.length * 14 + 16);
        y = doc.y + 2;

        // Section label
        doc.font("Helvetica-Bold")
            .fontSize(7)
            .fillColor(C.textLabel)
            .text("LABOUR ENTRIES", x + 14, y, { width: pageWidth - 28 });
        y += 10;

        // Labour table header
        const lCols = [
            (pageWidth - 16) * 0.06, // #
            (pageWidth - 16) * 0.25, // Process
            (pageWidth - 16) * 0.25, // Party
            (pageWidth - 16) * 0.15, // Rate
            (pageWidth - 16) * 0.14, // Rate Type
            (pageWidth - 16) * 0.15, // Cost
        ];
        const lHeaders = ["#", "Process", "Party", "Rate", "Rate Type", "Cost"];
        let lx = x + 8;
        lHeaders.forEach((h, i) => {
            drawCell(doc, lx, y, lCols[i]!, 14, h, {
                bg: C.labourHeaderBg,
                fontColor: C.white,
                fontSize: 7,
                bold: true,
                align: i === 0 || i >= 3 ? "center" : "left",
                borderColor: C.labourHeaderBg,
            });
            lx += lCols[i]!;
        });
        y += 14;

        // Labour rows
        labours.forEach((le, li) => {
            const rowBg = li % 2 === 0 ? C.labourRowEven : C.labourRowOdd;
            const vals = [
                String(li + 1),
                labourName(le.labourProcessType),
                partyName(le.party),
                fc(le.rate),
                le.rateType === "PER_KG" ? "Per Kg" : "Per Piece",
                fc(le.cost),
            ];
            lx = x + 8;
            vals.forEach((v, i) => {
                drawCell(doc, lx, y, lCols[i]!, 13, v, {
                    bg: rowBg,
                    fontSize: 7,
                    align: i === 0 || i >= 3 ? "center" : "left",
                    bold: i === 5,
                });
                lx += lCols[i]!;
            });
            y += 13;
        });

        // Labour total row
        const totalLabelW = lCols[0]! + lCols[1]! + lCols[2]! + lCols[3]! + lCols[4]!;
        drawCell(doc, x + 8, y, totalLabelW, 14, "Total Labour Cost", {
            bg: "#f1f5f9",
            fontSize: 7.5,
            bold: true,
            align: "right",
            borderColor: C.borderDark,
        });
        drawCell(doc, x + 8 + totalLabelW, y, lCols[5]!, 14, fc(part.totalLabourCost ?? 0), {
            bg: "#f1f5f9",
            fontSize: 8,
            bold: true,
            align: "center",
            borderColor: C.borderDark,
        });
        y += 14;
        doc.y = y + 2;
    } else {
        doc.y = y + 2;
    }
}

function drawCompleteSupplyDetails(
    doc: PDFKit.PDFDocument,
    part: CostingPart,
    x: number,
    pageWidth: number
) {
    const y = doc.y;
    const dateStr = part.completeSupplyDate
        ? new Date(part.completeSupplyDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
          })
        : "—";

    const colW = (pageWidth - 16) / 3;
    const cells: [string, string][] = [
        ["Rate / pc", fc(part.completeSupplyRate ?? 0)],
        ["Party", partyName(part.completeSupplyParty)],
        ["Date", dateStr],
    ];
    cells.forEach(([label, val], i) => {
        drawKVCell(doc, x + 8 + colW * i, y, colW, 24, label, val, { bg: C.supplyBg });
    });

    doc.y = y + 26;
}

function buildDimensionStr(part: CostingPart): string {
    const dims: string[] = [];
    if (part.diameter && part.diameter > 0) dims.push(`Dia ${part.diameter}`);
    if (part.width && part.width > 0) dims.push(`W ${part.width}`);
    if (part.thickness && part.thickness > 0) dims.push(`T ${part.thickness}`);
    if (part.innerDiameter && part.innerDiameter > 0) dims.push(`ID ${part.innerDiameter}`);
    if (part.length && part.length > 0) dims.push(`L ${part.length}`);
    return dims.length > 0 ? dims.join(" x ") + " mm" : "—";
}

function drawGrandTotal(doc: PDFKit.PDFDocument, data: CostingSheetData) {
    const pageWidth = pw(doc);
    const x = mg(doc).left;

    checkPageBreak(doc, 50);
    const y = doc.y + 8;

    doc.rect(x, y, pageWidth, 36).fill(C.greenBg);
    doc.rect(x, y, pageWidth, 36).lineWidth(1).strokeColor(C.greenBorder).stroke();
    doc.rect(x, y, 4, 36).fill(C.greenBorder);

    doc.font("Helvetica")
        .fontSize(9)
        .fillColor(C.greenText)
        .text("Grand Total", x + 16, y + 5, {
            width: pageWidth - 32,
        });
    doc.font("Helvetica-Bold")
        .fontSize(16)
        .fillColor(C.greenText)
        .text(fc(data.grandTotal), x + 16, y + 16, {
            width: pageWidth - 32,
        });

    // Items count on right
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(C.textMuted)
        .text(`${data.items.length} items`, x + pageWidth - 100, y + 13, {
            width: 80,
            align: "right",
        });

    doc.y = y + 44;
}

function drawFooter(doc: PDFKit.PDFDocument) {
    const x = mg(doc).left;
    checkPageBreak(doc, 40);
    const y = doc.y + 6;

    doc.font("Helvetica")
        .fontSize(7)
        .fillColor(C.textMuted)
        .text(
            "This is an internal costing reference document. Not for external distribution.",
            x,
            y
        );

    // Bottom bars
    doc.rect(0, doc.page.height - 7, doc.page.width, 2).fill(C.gold);
    doc.rect(0, doc.page.height - 5, doc.page.width, 5).fill(C.navy);
}
