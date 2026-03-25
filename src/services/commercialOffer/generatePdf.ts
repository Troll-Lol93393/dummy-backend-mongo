import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
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

function formatCurrency(val: number): string {
    return val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateCommercialOfferPdf(
    data: CommercialOfferData,
    company: CompanyInfo,
    logoBuffer?: Buffer | null
): PassThrough {
    const stream = new PassThrough();
    const doc = new PDFDocument({ margin: 50, size: "A4", layout: "landscape" });
    doc.pipe(stream);

    drawLetterhead(doc, data, company, logoBuffer);
    drawSubjectLine(doc, data);
    drawItemsTable(doc, data);
    drawTotals(doc, data);
    drawFooter(doc, data, company);

    doc.end();
    return stream;
}

function drawLetterhead(
    doc: PDFKit.PDFDocument,
    _data: CommercialOfferData,
    company: CompanyInfo,
    logoBuffer?: Buffer | null
): void {
    const pageWidth = pw(doc);
    const leftX = m(doc).left;

    // Top accent bars
    doc.rect(0, 0, doc.page.width, 6).fill(COLORS.primary);
    doc.rect(0, 6, doc.page.width, 3).fill(COLORS.accentGold);

    // Company header block
    const headerY = 18;
    const headerH = 80;
    doc.rect(leftX, headerY, pageWidth, headerH).fill(COLORS.primary);
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

    doc.font("Helvetica-Bold")
        .fontSize(24)
        .fillColor(COLORS.headerText)
        .text(company.name, textLeft, headerY + 12, { width: textWidth });

    doc.font("Helvetica")
        .fontSize(9)
        .fillColor("#8faabe")
        .text(company.tagline || "", leftX + 20, headerY + 42, { width: pageWidth - 40 });

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

    // Details row
    const detailY = headerY + headerH + 10;
    const colW = pageWidth / 3;

    doc.font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(COLORS.textMuted)
        .text("GSTIN", leftX, detailY);
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(company.gstin || "—", leftX, detailY + 10);

    doc.font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(COLORS.textMuted)
        .text("VENDOR CODE", leftX + colW, detailY);
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(company.vendorCode || "—", leftX + colW, detailY + 10);

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

function drawSubjectLine(doc: PDFKit.PDFDocument, data: CommercialOfferData): void {
    const pageWidth = pw(doc);
    const leftX = m(doc).left;
    const boxY = doc.y;

    doc.rect(leftX, boxY, pageWidth, 52).fillAndStroke("#eaf2f8", COLORS.primaryLight);
    doc.rect(leftX, boxY, 4, 52).fill(COLORS.accent);

    doc.font("Helvetica-Bold")
        .fontSize(14)
        .fillColor(COLORS.primary)
        .text("COMMERCIAL OFFER", leftX + 18, boxY + 8, { width: pageWidth - 30 });

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

function drawItemsTable(doc: PDFKit.PDFDocument, data: CommercialOfferData): void {
    const pageWidth = pw(doc);
    const startX = m(doc).left;

    // Column widths for landscape A4
    const cols = [35, 65, 120, 80, 40, 75, 70, 50, 80, 60, 80];
    const headers = [
        "Sl No.",
        "Item Code",
        "Item Name",
        "Material",
        "Qty",
        "Sale Price (₹)",
        "HSN Code",
        "GST %",
        "Total Before GST",
        "GST Amt",
        "Total with GST",
    ];

    // Table header
    checkPageBreak(doc, 25);
    let y = doc.y;

    doc.rect(startX, y, pageWidth, 22).fill(COLORS.headerBg);

    let xPos = startX;
    headers.forEach((header, i) => {
        doc.font("Helvetica-Bold")
            .fontSize(7)
            .fillColor(COLORS.headerText)
            .text(header, xPos + 2, y + 6, { width: cols[i]! - 4, align: "center" });
        xPos += cols[i]!;
    });

    y += 22;
    doc.y = y;

    // Data rows
    data.items.forEach((item, idx) => {
        const cellTexts = [
            item.serialNumber || String(idx + 1),
            item.itemCode,
            item.itemName,
            item.material || "—",
            String(item.quantity),
            formatCurrency(item.sellingPrice),
            item.hsnCode,
            `${item.gstPercent}%`,
            formatCurrency(item.totalBeforeGst),
            formatCurrency(item.gstAmount),
            formatCurrency(item.totalWithGst),
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
            const align = i >= 4 ? "right" : "left";
            doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica")
                .fontSize(7)
                .fillColor(COLORS.textDark)
                .text(text, xPos + 2, y + 4, { width: cols[i]! - 4, align });
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
    });
}

function drawTotals(doc: PDFKit.PDFDocument, data: CommercialOfferData): void {
    const pageWidth = pw(doc);
    const startX = m(doc).left;

    checkPageBreak(doc, 60);
    let y = doc.y + 5;

    // Totals box
    const boxW = 280;
    const boxX = startX + pageWidth - boxW;

    // Grand Total Before GST
    doc.rect(boxX, y, boxW, 20).fill("#f4f8fb");
    doc.rect(boxX, y, boxW, 20).strokeColor(COLORS.border).lineWidth(0.3).stroke();
    doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text("Total Before GST:", boxX + 10, y + 5, { width: 140, align: "left" });
    doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(`₹ ${formatCurrency(data.grandTotalBeforeGst)}`, boxX + 150, y + 5, {
            width: 120,
            align: "right",
        });
    y += 20;

    // GST Amount
    doc.rect(boxX, y, boxW, 20).fill("#fef9e7");
    doc.rect(boxX, y, boxW, 20).strokeColor(COLORS.border).lineWidth(0.3).stroke();
    doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text("Total GST (18%):", boxX + 10, y + 5, { width: 140, align: "left" });
    doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.textDark)
        .text(`₹ ${formatCurrency(data.grandGstAmount)}`, boxX + 150, y + 5, {
            width: 120,
            align: "right",
        });
    y += 20;

    // Grand Total with GST
    doc.rect(boxX, y, boxW, 24).fill(COLORS.primary);
    doc.font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLORS.headerText)
        .text("GRAND TOTAL:", boxX + 10, y + 6, { width: 140, align: "left" });
    doc.font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLORS.headerText)
        .text(`₹ ${formatCurrency(data.grandTotalWithGst)}`, boxX + 150, y + 6, {
            width: 120,
            align: "right",
        });
    y += 24;

    doc.y = y;
}

function drawFooter(
    doc: PDFKit.PDFDocument,
    data: CommercialOfferData,
    company: CompanyInfo
): void {
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
                .heightOfString(text, { width: cols[i]! - 4 }) + 8;
        if (h > maxH) maxH = h;
    });
    return maxH;
}
