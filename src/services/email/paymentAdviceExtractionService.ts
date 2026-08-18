// Preloaded via --require in both npm start and npm run dev (see
// package.json / nodemon.json), but imported directly here too — this is
// the entry point that actually invokes PDFParse's pdfjs-dist dependency,
// so it must not rely on load order from elsewhere.
import "../../polyfills";

import axios from "axios";
import { PDFParse } from "pdf-parse";

import { IEmail, IEmailAttachment } from "../../models/email.model";
import { logger } from "../../utils/logger";
import { parsePaymentAdvicePdfText, ParsedPaymentAdvice } from "./paymentAdvicePdfParser";

export interface PaymentAdviceExtractionResult {
    parsed: ParsedPaymentAdvice;
    rawPdfText: string;
}

function isPdfAttachment(attachment: IEmailAttachment): boolean {
    return attachment.contentType === "application/pdf" || /\.pdf$/i.test(attachment.filename);
}

/**
 * Downloads and OCR/text-extracts the PDF attachment on an SBI CMP ePayment
 * Advice email, then hands the raw text to the dedicated regex parser.
 * Returns null (never throws) when there's no usable PDF attachment or the
 * PDF's mandatory header line can't be located — the caller (orchestration
 * service) decides how to handle that (e.g. leave the email unprocessed for
 * a retry, or bump extractionFailCount).
 */
export async function extractPaymentAdviceFromEmail(
    email: Pick<IEmail, "attachments" | "subject">
): Promise<PaymentAdviceExtractionResult | null> {
    const pdfAttachment = email.attachments.find(isPdfAttachment);
    if (!pdfAttachment || !pdfAttachment.cloudinaryUrl) {
        logger.warn("PAYMENT_ADVICE_EXTRACT", `No PDF attachment found on email "${email.subject}"`);
        return null;
    }

    const response = await axios.get<ArrayBuffer>(pdfAttachment.cloudinaryUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
    });

    const buffer = Buffer.from(response.data);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const rawPdfText = result.text || "";

    if (!rawPdfText.trim()) {
        logger.warn("PAYMENT_ADVICE_EXTRACT", `PDF attachment produced no text for email "${email.subject}"`);
        return null;
    }

    const parsed = parsePaymentAdvicePdfText(rawPdfText);
    if (!parsed) {
        logger.warn(
            "PAYMENT_ADVICE_EXTRACT",
            `Failed to parse payment advice header from PDF text for email "${email.subject}"`
        );
        return null;
    }

    return { parsed, rawPdfText };
}
