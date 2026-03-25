import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
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
}

interface TechOfferData {
    prNumber: string;
    companyName: string;
    location: string;
    ownerName: string;
    deliveryWeeks: number;
    items: TechOfferItem[];
}

// ── Color palette ──
const COLORS = {
    primary: "#0f2b46" as const,
    primaryLight: "#1a5276" as const,
    accent: "#c0392b" as const,
    accentGold: "#d4a017" as const,
    headerBg: "#0f2b46" as const,
    headerText: "#ffffff" as const,
    rowEven: "#f4f8fb" as const,
    rowOdd: "#ffffff" as const,
    border: "#bdc3c7" as const,
    textDark: "#1a202c" as const,
    textMuted: "#555555" as const,
};

// Helper to safely get margin values
function m(doc: PDFKit.PDFDocument): { left: number; right: number; top: number; bottom: number } {
    const margins = doc.page.margins!;
    return {
        left: margins.left!,
        right: margins.right!,
        top: margins.top!,
        bottom: margins.bottom!,
    };
}

function pw(doc: PDFKit.PDFDocument): number {
    return doc.page.width - m(doc).left - m(doc).right;
}

function formatHardness(entries: HardnessEntry[]): string {
    if (!entries || entries.length === 0) return "—";
    return entries.map(h => `${h.hardnessType}: ${h.value} ${h.measurement}`).join(", ");
}

export function generateTechOfferPdf(
    data: TechOfferData,
    company: CompanyInfo,
    logoBuffer?: Buffer | null
): PassThrough {
    const stream = new PassThrough();
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(stream);

    drawLetterhead(doc, data, company, logoBuffer);
    drawSubjectLine(doc, data);
    drawItemsTable(doc, data);
    drawFooter(doc, data, company);

    doc.end();
    return stream;
}

function drawLetterhead(
    doc: PDFKit.PDFDocument,
    _data: TechOfferData,
    company: CompanyInfo,
    logoBuffer?: Buffer | null
): void {
    const pageWidth = pw(doc);
    const leftX = m(doc).left;

    // ── Top gradient bar (navy + gold accent) ──
    doc.rect(0, 0, doc.page.width, 6).fill(COLORS.primary);
    doc.rect(0, 6, doc.page.width, 3).fill(COLORS.accentGold);

    // ── Company header block ──
    const headerY = 18;
    const headerH = 80;
    doc.rect(leftX, headerY, pageWidth, headerH).fill(COLORS.primary);

    // Decorative left accent stripe inside header
    doc.rect(leftX, headerY, 5, headerH).fill(COLORS.accentGold);

    // Logo (right side of header)
    const logoWidth = 80;
    const logoHeight = 40;
    const textLeft = leftX + 20;
    let textWidth = pageWidth - 40;
    if (logoBuffer) {
        try {
            const logoX = leftX + pageWidth - logoWidth - 15;
            const logoY = headerY + 10;
            doc.image(logoBuffer, logoX, logoY, {
                fit: [logoWidth, logoHeight],
                align: "center",
                valign: "center",
            });
            textWidth = pageWidth - logoWidth - 60;
        } catch {
            // Ignore logo errors, continue without logo
        }
    }

    // Company name
    doc.font("Helvetica-Bold")
        .fontSize(24)
        .fillColor(COLORS.headerText)
        .text(company.name, textLeft, headerY + 12, { width: textWidth });

    // Tagline
    doc.font("Helvetica")
        .fontSize(9)
        .fillColor("#8faabe")
        .text(company.tagline || "", leftX + 20, headerY + 42, {
            width: pageWidth - 40,
        });

    // Address line
    doc.font("Helvetica")
        .fontSize(7.5)
        .fillColor("#aec6d4")
        .text(
            [company.address, company.phone ? `Ph: ${company.phone}` : ""]
                .filter(Boolean)
                .join("  |  "),
            leftX + 20,
            headerY + 58,
            { width: pageWidth - 40 }
        );

    // ── Details row below header ──
    const detailY = headerY + headerH + 10;
    const colW = pageWidth / 3;

    // GST
    doc.font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(COLORS.textMuted)
        .text("GSTIN", leftX, detailY);
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(company.gstin || "—", leftX, detailY + 10);

    // Vendor Code
    doc.font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(COLORS.textMuted)
        .text("VENDOR CODE", leftX + colW, detailY);
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(company.vendorCode || "—", leftX + colW, detailY + 10);

    // Date
    doc.font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(COLORS.textMuted)
        .text("DATE", leftX + colW * 2, detailY);
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(
            new Date().toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }),
            leftX + colW * 2,
            detailY + 10
        );

    // Separator
    doc.moveTo(leftX, detailY + 26)
        .lineTo(leftX + pageWidth, detailY + 26)
        .strokeColor(COLORS.accentGold)
        .lineWidth(1)
        .stroke();

    doc.y = detailY + 36;
}

function drawSubjectLine(doc: PDFKit.PDFDocument, data: TechOfferData): void {
    const pageWidth = pw(doc);
    const leftX = m(doc).left;

    const boxY = doc.y;
    // Subject box with left accent
    doc.rect(leftX, boxY, pageWidth, 52).fillAndStroke("#eaf2f8", COLORS.primaryLight);
    doc.rect(leftX, boxY, 4, 52).fill(COLORS.accent);

    doc.font("Helvetica-Bold")
        .fontSize(14)
        .fillColor(COLORS.primary)
        .text(`TECHNICAL OFFER`, leftX + 18, boxY + 8, { width: pageWidth - 30 });

    doc.font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.textDark)
        .text(
            `RFQ No: ${data.prNumber}   |   Company: ${data.companyName}   |   Location: ${data.location}`,
            leftX + 18,
            boxY + 30,
            { width: pageWidth - 30 }
        );

    doc.y = boxY + 64;
}

function drawItemsTable(doc: PDFKit.PDFDocument, data: TechOfferData): void {
    const pageWidth = pw(doc);
    const startX = m(doc).left;

    // Column widths — Qty before Remarks
    const cols = [30, 55, 75, 45, 65, 50, 30, 145];
    const headers = [
        "Sl No.",
        "Item Code",
        "Item Name",
        "Drg No.",
        "MOC & Grade",
        "Hardness",
        "Qty",
        "Remarks",
    ];

    // Table header
    let y = doc.y;
    checkPageBreak(doc, 25);
    y = doc.y;

    doc.rect(startX, y, pageWidth, 22).fill(COLORS.headerBg);

    let xPos = startX;
    headers.forEach((header, i) => {
        doc.font("Helvetica-Bold")
            .fontSize(7.5)
            .fillColor(COLORS.headerText)
            .text(header, xPos + 3, y + 6, { width: cols[i]! - 6, align: "left" });
        xPos += cols[i]!;
    });

    y += 22;
    doc.y = y;

    // Table rows
    data.items.forEach((item, idx) => {
        const isSetOrAssembly = item.itemType === "SET" || item.itemType === "ASSEMBLY";

        const hardnessStr = formatHardness(item.hardness);
        const mocGrade = [item.material, item.grade].filter(Boolean).join(" / ") || "—";

        // Qty before Remarks
        const cellTexts = [
            item.serialNumber || String(idx + 1),
            item.itemCode,
            item.itemName,
            item.drawingNumber || "—",
            mocGrade,
            hardnessStr,
            String(item.quantity),
            item.remarks || "—",
        ];

        const rowHeight = calculateRowHeight(doc, cellTexts, cols, 7);

        checkPageBreak(doc, rowHeight + 5);
        y = doc.y;

        const bgColor = idx % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
        doc.rect(startX, y, pageWidth, rowHeight).fill(bgColor);
        doc.rect(startX, y, pageWidth, rowHeight)
            .strokeColor(COLORS.border)
            .lineWidth(0.3)
            .stroke();

        xPos = startX;
        cellTexts.forEach((text, i) => {
            doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica")
                .fontSize(7)
                .fillColor(COLORS.textDark)
                .text(text, xPos + 3, y + 4, { width: cols[i]! - 6, align: "left" });
            xPos += cols[i]!;
        });

        // Vertical lines
        xPos = startX;
        cols.forEach(w => {
            doc.moveTo(xPos, y)
                .lineTo(xPos, y + rowHeight)
                .strokeColor(COLORS.border)
                .lineWidth(0.3)
                .stroke();
            xPos += w;
        });
        doc.moveTo(xPos, y)
            .lineTo(xPos, y + rowHeight)
            .strokeColor(COLORS.border)
            .lineWidth(0.3)
            .stroke();

        y += rowHeight;
        doc.y = y;

        // BOM sub-table for SET/ASSEMBLY
        if (isSetOrAssembly && item.bom.length > 0) {
            drawBomSubTable(doc, item.bom, startX, pageWidth);
        }
    });
}

function drawBomSubTable(
    doc: PDFKit.PDFDocument,
    bom: BomEntry[],
    startX: number,
    pageWidth: number
): void {
    checkPageBreak(doc, 35);
    let y = doc.y;

    // BOM label
    doc.rect(startX, y, pageWidth, 16).fill("#fef9e7");
    doc.rect(startX, y, 3, 16).fill(COLORS.accentGold);
    doc.font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(COLORS.textDark)
        .text("   BOM / Sub-Parts:", startX + 8, y + 4, { width: pageWidth - 16 });
    y += 16;
    doc.y = y;

    // BOM columns: #, Part Name, Material & Grade, Qty, Hardness, Remarks
    const bomCols = [30, 120, 110, 40, 100, 95];
    const bomHeaders = ["#", "Part Name", "Material & Grade", "Qty", "Hardness", "Remarks"];

    checkPageBreak(doc, 18);
    y = doc.y;
    doc.rect(startX + 10, y, pageWidth - 20, 16).fill("#566573");

    let bx = startX + 10;
    bomHeaders.forEach((h, i) => {
        doc.font("Helvetica-Bold")
            .fontSize(6.5)
            .fillColor("#ffffff")
            .text(h, bx + 2, y + 4, { width: bomCols[i]! - 4, align: "left" });
        bx += bomCols[i]!;
    });
    y += 16;
    doc.y = y;

    bom.forEach((part, pi) => {
        const matGrade = [part.material, part.grade].filter(Boolean).join(" / ") || "—";
        const partHardness = formatHardness(part.hardness ?? []);
        const partRemarks = part.remarks || "—";

        const bomTexts = [
            String(pi + 1),
            part.partName,
            matGrade,
            String(part.quantity),
            partHardness,
            partRemarks,
        ];

        const rh = calculateRowHeight(doc, bomTexts, bomCols, 6.5);
        checkPageBreak(doc, rh + 2);
        y = doc.y;

        const bg = pi % 2 === 0 ? "#fdfefe" : "#f2f4f4";
        doc.rect(startX + 10, y, pageWidth - 20, rh).fill(bg);
        doc.rect(startX + 10, y, pageWidth - 20, rh)
            .strokeColor(COLORS.border)
            .lineWidth(0.2)
            .stroke();

        bx = startX + 10;
        bomTexts.forEach((t, i) => {
            doc.font("Helvetica")
                .fontSize(6.5)
                .fillColor(COLORS.textDark)
                .text(t, bx + 2, y + 3, {
                    width: bomCols[i]! - 4,
                    align: "left",
                });
            bx += bomCols[i]!;
        });

        y += rh;
        doc.y = y;
    });

    doc.y += 4;
}

function drawFooter(doc: PDFKit.PDFDocument, data: TechOfferData, company: CompanyInfo): void {
    const pageWidth = pw(doc);
    const startX = m(doc).left;

    checkPageBreak(doc, 130);
    const y = doc.y + 15;

    // Delivery box
    doc.rect(startX, y, pageWidth, 32).fillAndStroke("#eafaf1", "#27ae60");
    doc.rect(startX, y, 4, 32).fill("#27ae60");
    doc.font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#1e8449")
        .text(
            `Delivery: ${data.deliveryWeeks ? `${data.deliveryWeeks} weeks` : "As mutually agreed"} from the date of order confirmation`,
            startX + 14,
            y + 10,
            { width: pageWidth - 28 }
        );

    // Signature section
    const sigY = y + 58;
    doc.font("Helvetica")
        .fontSize(9)
        .fillColor(COLORS.textMuted)
        .text("For " + company.name, startX, sigY);

    doc.moveTo(startX, sigY + 40)
        .lineTo(startX + 180, sigY + 40)
        .strokeColor(COLORS.textDark)
        .lineWidth(0.5)
        .stroke();

    doc.font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(COLORS.textDark)
        .text("Authorized Signatory", startX, sigY + 45);

    let contactY = sigY + 58;
    if (company.contactPersonName) {
        doc.font("Helvetica-Bold")
            .fontSize(8)
            .fillColor(COLORS.textDark)
            .text(company.contactPersonName, startX, contactY);
        contactY += 12;
    }
    if (company.contactPersonPhone) {
        doc.font("Helvetica")
            .fontSize(8)
            .fillColor(COLORS.textMuted)
            .text(`Ph: ${company.contactPersonPhone}`, startX, contactY);
        contactY += 12;
    }
    if (!company.contactPersonName && data.ownerName) {
        doc.font("Helvetica")
            .fontSize(8)
            .fillColor(COLORS.textMuted)
            .text(data.ownerName, startX, contactY);
    }

    // Bottom bars
    doc.rect(0, doc.page.height - 9, doc.page.width, 3).fill(COLORS.accentGold);
    doc.rect(0, doc.page.height - 6, doc.page.width, 6).fill(COLORS.primary);
}

function checkPageBreak(doc: PDFKit.PDFDocument, requiredHeight: number): void {
    const bottomMargin = m(doc).bottom + 20;
    if (doc.y + requiredHeight > doc.page.height - bottomMargin) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, 4).fill(COLORS.primary);
        doc.rect(0, 4, doc.page.width, 2).fill(COLORS.accentGold);
        doc.y = m(doc).top + 12;
    }
}

function calculateRowHeight(
    doc: PDFKit.PDFDocument,
    texts: string[],
    cols: number[],
    fontSize: number
): number {
    let maxH = 18;
    texts.forEach((text, i) => {
        const h =
            doc
                .font("Helvetica")
                .fontSize(fontSize)
                .heightOfString(text, { width: cols[i]! - 6 }) + 8;
        if (h > maxH) maxH = h;
    });
    return maxH;
}
