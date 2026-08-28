import { Sales } from "../../models/sales.model";
import { PaymentAdvice } from "../../models/paymentAdvice.model";
import { InvoiceFollowUpTracking } from "../../models/invoiceFollowUpTracking.model";
import { getEmailSettings } from "../../models/emailSettings.model";
import { buildMimeMessage } from "../../utils/mailer";
import { appendToMailbox } from "./replySenderService";
import { logger } from "../../utils/logger";
import {
    generateShortPaymentDraftHtml,
    generateOverdueFollowUpDraftHtml,
    buildShortPaymentSubject,
    buildOverdueFollowUpSubject,
} from "./paymentFollowUpDraftService";

const VENDOR_HELP_DESK: { name: string; address: string } = {
    name: "JSW Vendor Help Desk",
    address: "vendorhelpdesk.gbs@jsw.in",
};

const BATCH_LIMIT = 20;
const OVERDUE_DAYS_THRESHOLD = 45;
const OVERDUE_REDRAFT_CADENCE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function getInvoiceContext(
    invoiceNumber: string
): Promise<{ poNumber?: string; barcode?: string; location?: string }> {
    const sale = await Sales.findOne({ invoiceNumber, isDeleted: false })
        .select("poNumber barcode companyName")
        .lean();
    if (!sale) return {};
    return { poNumber: sale.poNumber, barcode: sale.barcode, location: sale.companyName };
}

/**
 * Auto-creates a Gmail draft (IMAP APPEND to \Drafts, never sent) querying
 * JSW's vendor help desk for each invoice row the matching service flagged
 * as SHORT_PAYMENT. One-shot per row — idempotent via followUpDraftStatus
 * on the row itself, so a row is never re-drafted once created.
 *
 * Fully gated by settings.autoPaymentFollowUpEnabled: ingestion/matching
 * (paymentAdviceProcessingService.ts) always runs regardless of this
 * setting — only this outbound draft creation is toggle-gated.
 */
export async function createShortPaymentFollowUpDrafts(): Promise<number> {
    const settings = await getEmailSettings();
    if (!settings.autoPaymentFollowUpEnabled) return 0;

    const advices = await PaymentAdvice.find({
        isDeleted: false,
        invoiceRows: {
            $elemMatch: { matchStatus: "SHORT_PAYMENT", followUpDraftStatus: { $exists: false } },
        },
    }).limit(BATCH_LIMIT);

    let created = 0;

    for (const advice of advices) {
        for (const row of advice.invoiceRows) {
            if (row.matchStatus !== "SHORT_PAYMENT" || row.followUpDraftStatus) continue;

            try {
                const salesTotal = await Sales.aggregate<{ _id: string; total: number }>([
                    { $match: { invoiceNumber: row.invoiceNumber, isDeleted: false } },
                    { $group: { _id: "$invoiceNumber", total: { $sum: "$netAmount" } } },
                ]);
                const salesInvoiceTotal = salesTotal[0]?.total ?? row.invoiceTotalAmount;
                const context = await getInvoiceContext(row.invoiceNumber);

                const html = generateShortPaymentDraftHtml(
                    {
                        invoiceNumber: row.invoiceNumber,
                        utrNo: advice.utrNo,
                        amountReceived: row.actualAllocated || 0,
                        shortfallAmount: row.shortfallAmount || 0,
                        ...context,
                    },
                    salesInvoiceTotal
                );

                const { raw } = await buildMimeMessage({
                    to: [VENDOR_HELP_DESK],
                    subject: buildShortPaymentSubject(row.invoiceNumber),
                    html,
                });

                await appendToMailbox(raw, "\\Drafts", ["\\Draft"]);

                row.followUpDraftStatus = "DRAFTED";
                row.followUpDraftedAt = new Date();
                created += 1;
            } catch (err) {
                logger.error(
                    "PAYMENT_FOLLOWUP",
                    `Failed to create short-payment draft for invoice ${row.invoiceNumber}`,
                    { error: String(err) }
                );
            }
        }
        await advice.save();
    }

    return created;
}

interface OverdueInvoiceCandidate {
    _id: string;
    invoiceDate: Date;
    poNumber?: string;
    barcode?: string;
    companyName?: string;
}

/**
 * Auto-creates a Gmail draft querying JSW's vendor help desk for invoices
 * that are >45 days overdue with NO payment received at all (no
 * PaymentAdvice row references them whatsoever — a partial/short payment is
 * handled by createShortPaymentFollowUpDrafts instead).
 *
 * Weekly re-draft cadence: only creates a new draft once 7+ days have
 * passed since the last one for that invoice, tracked on a lightweight
 * per-invoice InvoiceFollowUpTracking doc (a PaymentAdvice row can't carry
 * this — these invoices have no PaymentAdvice at all).
 */
export async function createOverdueFollowUpDrafts(): Promise<number> {
    const settings = await getEmailSettings();
    if (!settings.autoPaymentFollowUpEnabled) return 0;

    const cutoffDate = new Date(Date.now() - OVERDUE_DAYS_THRESHOLD * MS_PER_DAY);
    const advisedInvoiceNumbers = await PaymentAdvice.distinct("invoiceRows.invoiceNumber", {
        isDeleted: false,
    });

    const candidates = await Sales.aggregate<OverdueInvoiceCandidate>([
        { $match: { isDeleted: false, invoiceNumber: { $nin: advisedInvoiceNumbers } } },
        {
            $group: {
                _id: "$invoiceNumber",
                invoiceDate: { $min: "$invoiceDate" },
                poNumber: { $first: "$poNumber" },
                barcode: { $first: "$barcode" },
                companyName: { $first: "$companyName" },
            },
        },
        { $match: { invoiceDate: { $lte: cutoffDate } } },
        { $limit: BATCH_LIMIT },
    ]);

    if (candidates.length === 0) return 0;

    const invoiceNumbers = candidates.map(c => c._id);
    const trackingDocs = await InvoiceFollowUpTracking.find({ invoiceNumber: { $in: invoiceNumbers } });
    const trackingByInvoice = new Map(trackingDocs.map(t => [t.invoiceNumber, t]));

    let created = 0;
    const now = new Date();

    for (const candidate of candidates) {
        const invoiceNumber = candidate._id;
        const tracking = trackingByInvoice.get(invoiceNumber);

        if (tracking?.resolved) continue;
        if (tracking && now.getTime() - tracking.lastDraftedAt.getTime() < OVERDUE_REDRAFT_CADENCE_DAYS * MS_PER_DAY) {
            continue;
        }

        try {
            const daysOverdue = Math.floor((now.getTime() - candidate.invoiceDate.getTime()) / MS_PER_DAY);
            const html = generateOverdueFollowUpDraftHtml(invoiceNumber, candidate.invoiceDate, daysOverdue, {
                poNumber: candidate.poNumber,
                barcode: candidate.barcode,
                location: candidate.companyName,
            });

            const { raw, messageId } = await buildMimeMessage({
                to: [VENDOR_HELP_DESK],
                subject: buildOverdueFollowUpSubject(invoiceNumber, candidate.invoiceDate),
                html,
            });

            await appendToMailbox(raw, "\\Drafts", ["\\Draft"]);

            await InvoiceFollowUpTracking.findOneAndUpdate(
                { invoiceNumber },
                {
                    $set: { lastDraftedAt: now, lastDraftMessageId: messageId },
                    $inc: { draftCount: 1 },
                },
                { upsert: true, setDefaultsOnInsert: true }
            );
            created += 1;
        } catch (err) {
            logger.error("PAYMENT_FOLLOWUP", `Failed to create overdue-follow-up draft for invoice ${invoiceNumber}`, {
                error: String(err),
            });
        }
    }

    return created;
}
