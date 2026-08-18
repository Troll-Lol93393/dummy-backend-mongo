import { Email } from "../../models/email.model";
import { logger } from "../../utils/logger";
import { extractPaymentAdviceFromEmail } from "./paymentAdviceExtractionService";
import { reconcilePaymentAdvice } from "./paymentMatchingService";

const SBI_CMP_SENDER = "support.cmpcorp@alerts.sbi.bank.in";
const BATCH_LIMIT = 20;
const MAX_EXTRACTION_ATTEMPTS = 3;

/**
 * Ingestion + reconciliation orchestration for SBI CMP ePayment Advice
 * emails. Runs unconditionally on every cron tick (unlike the outbound
 * follow-up drafts) — this is just data logging into PaymentAdvice, not a
 * customer-facing action, so there's no toggle gating it.
 *
 * Mirrors the isProcessed lifecycle used elsewhere in the email pipeline:
 * a successfully reconciled email is marked isProcessed so it's never
 * re-queried; a failed extraction bumps extractionFailCount and is retried
 * on the next tick, up to MAX_EXTRACTION_ATTEMPTS.
 */
export async function processPaymentAdvices(): Promise<number> {
    const candidates = await Email.find({
        isDeleted: false,
        isProcessed: false,
        "from.address": SBI_CMP_SENDER,
        extractionFailCount: { $lt: MAX_EXTRACTION_ATTEMPTS },
    })
        .sort({ date: -1 })
        .limit(BATCH_LIMIT);

    let processed = 0;

    for (const email of candidates) {
        try {
            if (email.attachments.length === 0) {
                // Never going to gain a PDF attachment after the fact —
                // retrying wastes cycles, so just mark it done.
                logger.warn("PAYMENT_ADVICE", `Email ${email._id} has no attachments — marking processed`);
                email.isProcessed = true;
                await email.save();
                continue;
            }

            const extraction = await extractPaymentAdviceFromEmail(email);
            if (!extraction) {
                email.extractionFailCount = (email.extractionFailCount || 0) + 1;
                await email.save();
                logger.warn(
                    "PAYMENT_ADVICE",
                    `Extraction failed for email ${email._id} (attempt #${email.extractionFailCount})`
                );
                continue;
            }

            await reconcilePaymentAdvice(email._id, extraction.parsed, extraction.rawPdfText);

            email.isProcessed = true;
            await email.save();
            processed += 1;
        } catch (err) {
            logger.error("PAYMENT_ADVICE", `Unexpected error processing email ${email._id}`, {
                error: String(err),
            });
            try {
                email.extractionFailCount = (email.extractionFailCount || 0) + 1;
                await email.save();
            } catch {
                // Best-effort — if even this save fails, the next cron tick retries anyway.
            }
        }
    }

    if (processed > 0) {
        logger.info("PAYMENT_ADVICE", `Processed ${processed} payment advice email(s)`);
    }

    return processed;
}
