import mongoose from "mongoose";

import { Sales } from "../../models/sales.model";
import { PaymentAdvice, IPaymentAdviceInvoiceRow } from "../../models/paymentAdvice.model";
import { logger } from "../../utils/logger";
import { ParsedPaymentAdvice } from "./paymentAdvicePdfParser";

// ₹5 tolerance for cross-checking the PDF's stated previousPaidAmount
// against what this system already has recorded as received for that
// invoice (see step 3 of the matching rule).
const PREVIOUS_PAID_RECONCILIATION_TOLERANCE = 5;
// ₹1 rounding tolerance on the FINAL shortfall comparison only — never
// applied when computing the TDS deduction itself.
const SHORTFALL_TOLERANCE = 1;

async function getSalesTotalsByInvoice(invoiceNumbers: string[]): Promise<Map<string, number>> {
    if (invoiceNumbers.length === 0) return new Map();
    const sales = await Sales.find({ invoiceNumber: { $in: invoiceNumbers }, isDeleted: false })
        .select("invoiceNumber netAmount")
        .lean();

    const totals = new Map<string, number>();
    for (const sale of sales) {
        totals.set(sale.invoiceNumber, (totals.get(sale.invoiceNumber) || 0) + (sale.netAmount || 0));
    }
    return totals;
}

/**
 * Sum of actualAllocated already recorded against each invoice number by
 * OTHER PaymentAdvice documents (excludes the advice currently being
 * (re-)processed, so idempotent re-runs never double-count themselves).
 */
async function getPriorRecordedReceivedByInvoice(
    invoiceNumbers: string[],
    excludeCmpReferenceNo: string
): Promise<Map<string, number>> {
    if (invoiceNumbers.length === 0) return new Map();
    const priorAdvices = await PaymentAdvice.find({
        "invoiceRows.invoiceNumber": { $in: invoiceNumbers },
        cmpReferenceNo: { $ne: excludeCmpReferenceNo },
        isDeleted: false,
    })
        .select("invoiceRows.invoiceNumber invoiceRows.actualAllocated")
        .lean();

    const totals = new Map<string, number>();
    for (const advice of priorAdvices) {
        for (const row of advice.invoiceRows) {
            if (!invoiceNumbers.includes(row.invoiceNumber)) continue;
            totals.set(row.invoiceNumber, (totals.get(row.invoiceNumber) || 0) + (row.actualAllocated || 0));
        }
    }
    return totals;
}

interface RowComputation {
    invoiceNumber: string;
    docDate: Date;
    bankPaymentDocNo: string;
    invoiceTotalAmount: number;
    tdsAmount: number;
    retentionAmount: number;
    otherHoldAmount: number;
    previousPaidAmount: number;
    expectedNet: number;
    remainingExpectedThisTime: number;
    matched: boolean;
    previousPaidReconciliationMismatch: boolean;
}

/** Step 1-4 of the matching rule, per row (no cross-row attribution yet). */
async function computeRows(
    parsed: ParsedPaymentAdvice,
    salesTotals: Map<string, number>,
    priorReceivedByInvoice: Map<string, number>
): Promise<RowComputation[]> {
    const computations: RowComputation[] = [];

    for (const row of parsed.rows) {
        const existsInSales = salesTotals.has(row.invoiceNumber);
        if (!existsInSales) {
            // Step 8: never guess — skip amount calculations entirely.
            computations.push({
                ...row,
                expectedNet: 0,
                remainingExpectedThisTime: 0,
                matched: false,
                previousPaidReconciliationMismatch: false,
            });
            continue;
        }

        // Step 1: TDS is the only legitimate deduction. Retention/other-hold
        // are NOT subtracted here — they surface naturally as a shortfall
        // once actualAllocated (the money that really landed) comes in lower.
        const expectedNet = row.invoiceTotalAmount - row.tdsAmount;
        let previousPaidReconciliationMismatch = false;

        // Step 3: cross-check the PDF's previousPaidAmount against our own
        // records, but still use the PDF's value for the calculation.
        if (row.previousPaidAmount > 0) {
            const priorRecordedReceived = priorReceivedByInvoice.get(row.invoiceNumber) || 0;
            const diff = Math.abs(row.previousPaidAmount - priorRecordedReceived);
            if (diff > PREVIOUS_PAID_RECONCILIATION_TOLERANCE) {
                previousPaidReconciliationMismatch = true;
                logger.warn(
                    "PAYMENT_MATCHING",
                    `previousPaidAmount from PDF (${row.previousPaidAmount}) does not match this system's ` +
                        `recorded received amount (${priorRecordedReceived}) for invoice ${row.invoiceNumber} ` +
                        `— flagged for manual review`,
                    { cmpReferenceNo: parsed.cmpReferenceNo }
                );
            }
        }

        computations.push({
            ...row,
            expectedNet,
            remainingExpectedThisTime: expectedNet - row.previousPaidAmount, // Step 4
            matched: true,
            previousPaidReconciliationMismatch,
        });
    }

    return computations;
}

/** Step 5-7: proportional attribution of the advice's actual credited amount, then shortfall + status. */
function buildInvoiceRows(
    parsed: ParsedPaymentAdvice,
    computations: RowComputation[],
    existingRowByInvoice: Map<string, IPaymentAdviceInvoiceRow>
): IPaymentAdviceInvoiceRow[] {
    const sumRemainingExpected = computations
        .filter(c => c.matched)
        .reduce((sum, c) => sum + c.remainingExpectedThisTime, 0);

    return computations.map(c => {
        const existing = existingRowByInvoice.get(c.invoiceNumber);
        // Preserve outbound-draft/manual-resolution state across idempotent
        // re-processing — a re-run must never forget an already-sent draft
        // or a manual resolution.
        const preserved = {
            followUpDraftStatus: existing?.followUpDraftStatus,
            followUpDraftedAt: existing?.followUpDraftedAt,
            manuallyResolved: existing?.manuallyResolved,
            manuallyResolvedAt: existing?.manuallyResolvedAt,
        };

        if (!c.matched) {
            return {
                invoiceNumber: c.invoiceNumber,
                docDate: c.docDate,
                bankPaymentDocNo: c.bankPaymentDocNo,
                invoiceTotalAmount: c.invoiceTotalAmount,
                tdsAmount: c.tdsAmount,
                retentionAmount: c.retentionAmount,
                otherHoldAmount: c.otherHoldAmount,
                previousPaidAmount: c.previousPaidAmount,
                expectedNet: 0,
                matchStatus: "UNMATCHED",
                ...preserved,
            };
        }

        // Step 5: proportional share of the header's actual credited amount.
        const actualAllocated =
            sumRemainingExpected > 0 ? parsed.amount * (c.remainingExpectedThisTime / sumRemainingExpected) : 0;
        // Step 6: floor at 0 — overpayment is not a shortfall.
        const shortfallAmount = Math.max(0, c.remainingExpectedThisTime - actualAllocated);
        // Step 7: ₹1 tolerance on this final comparison only.
        const matchStatus = shortfallAmount > SHORTFALL_TOLERANCE ? "SHORT_PAYMENT" : "MATCHED";

        return {
            invoiceNumber: c.invoiceNumber,
            docDate: c.docDate,
            bankPaymentDocNo: c.bankPaymentDocNo,
            invoiceTotalAmount: c.invoiceTotalAmount,
            tdsAmount: c.tdsAmount,
            retentionAmount: c.retentionAmount,
            otherHoldAmount: c.otherHoldAmount,
            previousPaidAmount: c.previousPaidAmount,
            expectedNet: c.expectedNet,
            actualAllocated,
            matchStatus,
            shortfallAmount,
            previousPaidReconciliationMismatch: c.previousPaidReconciliationMismatch,
            ...preserved,
        };
    });
}

/**
 * Implements the confirmed reconciliation rule end to end for one parsed
 * advice and upserts the PaymentAdvice document — idempotent by
 * cmpReferenceNo, so a re-synced or re-processed copy of the same email
 * never creates a duplicate reconciliation record, and never forgets
 * outbound-draft or manual-resolution state already recorded on a row.
 */
export async function reconcilePaymentAdvice(
    emailId: mongoose.Types.ObjectId,
    parsed: ParsedPaymentAdvice,
    rawPdfText: string
): Promise<void> {
    const invoiceNumbers = [...new Set(parsed.rows.map(r => r.invoiceNumber))];

    const [salesTotals, priorReceivedByInvoice, existing] = await Promise.all([
        getSalesTotalsByInvoice(invoiceNumbers),
        getPriorRecordedReceivedByInvoice(invoiceNumbers, parsed.cmpReferenceNo),
        PaymentAdvice.findOne({ cmpReferenceNo: parsed.cmpReferenceNo }).lean(),
    ]);

    const existingRowByInvoice = new Map(
        (existing?.invoiceRows || []).map(row => [row.invoiceNumber, row])
    );

    const computations = await computeRows(parsed, salesTotals, priorReceivedByInvoice);
    const invoiceRows = buildInvoiceRows(parsed, computations, existingRowByInvoice);

    await PaymentAdvice.findOneAndUpdate(
        { cmpReferenceNo: parsed.cmpReferenceNo },
        {
            $set: {
                email: emailId,
                utrNo: parsed.utrNo,
                amount: parsed.amount,
                paymentDate: parsed.paymentDate,
                payerCompanyName: parsed.payerCompanyName,
                invoiceRows,
                rawPdfText,
                isDeleted: false,
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );

    const shortPayments = invoiceRows.filter(r => r.matchStatus === "SHORT_PAYMENT").length;
    const unmatched = invoiceRows.filter(r => r.matchStatus === "UNMATCHED").length;
    logger.info(
        "PAYMENT_MATCHING",
        `Reconciled payment advice ${parsed.cmpReferenceNo}: ${invoiceRows.length} row(s), ` +
            `${shortPayments} short-payment(s), ${unmatched} unmatched`
    );
}
