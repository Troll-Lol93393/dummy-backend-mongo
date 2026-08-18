import { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { ApiResponse } from "../utils/apiResponse";
import { PaymentAdvice, PaymentAdviceRowMatchStatus } from "../models/paymentAdvice.model";
import { Sales } from "../models/sales.model";

const VALID_MATCH_STATUSES: PaymentAdviceRowMatchStatus[] = ["MATCHED", "SHORT_PAYMENT", "UNMATCHED"];
const DEFAULT_AGING_THRESHOLD_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── List payment advices (paginated + filterable) ─────────────────────────

export const getPaymentAdvices = asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size as string) || 20));

    const filter: Record<string, unknown> = { isDeleted: false };

    const matchStatus = req.query.matchStatus as string | undefined;
    if (matchStatus && VALID_MATCH_STATUSES.includes(matchStatus as PaymentAdviceRowMatchStatus)) {
        filter.invoiceRows = { $elemMatch: { matchStatus } };
    }

    const [advices, total] = await Promise.all([
        PaymentAdvice.find(filter)
            .sort({ paymentDate: -1 })
            .skip((page - 1) * size)
            .limit(size)
            .lean(),
        PaymentAdvice.countDocuments(filter),
    ]);

    res.status(200).json(
        new ApiResponse(
            200,
            { advices, total, page, size, totalPages: Math.ceil(total / size) },
            "Payment advices fetched"
        )
    );
});

export const getPaymentAdviceById = asyncHandler(async (req: Request, res: Response) => {
    const advice = await PaymentAdvice.findOne({ _id: req.params.id, isDeleted: false }).lean();
    if (!advice) throw new ApiError(404, "Payment advice not found");

    res.status(200).json(new ApiResponse(200, advice, "Payment advice fetched"));
});

// ─── Aging report (unpaid invoices >N days) ─────────────────────────────────

interface AgingCandidate {
    _id: string;
    invoiceDate: Date;
    poNumber?: string;
    companyName?: string;
}

/**
 * Lists invoices with NO payment recorded against them at all (no
 * PaymentAdvice row references the invoice number whatsoever) that are
 * older than the aging threshold — same "no matching PaymentAdvice at all"
 * definition used by createOverdueFollowUpDrafts. Defaults to 45 days;
 * override with ?days=.
 */
export const getPaymentAging = asyncHandler(async (req: Request, res: Response) => {
    const thresholdDays = Math.max(1, parseInt(req.query.days as string) || DEFAULT_AGING_THRESHOLD_DAYS);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size as string) || 20));
    const cutoffDate = new Date(Date.now() - thresholdDays * MS_PER_DAY);

    const advisedInvoiceNumbers = await PaymentAdvice.distinct("invoiceRows.invoiceNumber", {
        isDeleted: false,
    });

    const pipeline = [
        { $match: { isDeleted: false, invoiceNumber: { $nin: advisedInvoiceNumbers } } },
        {
            $group: {
                _id: "$invoiceNumber",
                invoiceDate: { $min: "$invoiceDate" },
                poNumber: { $first: "$poNumber" },
                companyName: { $first: "$companyName" },
            },
        },
        { $match: { invoiceDate: { $lte: cutoffDate } } },
        { $sort: { invoiceDate: 1 as const } },
    ];

    const [allCandidates, countResult] = await Promise.all([
        Sales.aggregate<AgingCandidate>([...pipeline, { $skip: (page - 1) * size }, { $limit: size }]),
        Sales.aggregate<{ count: number }>([...pipeline, { $count: "count" }]),
    ]);

    const now = Date.now();
    const results = allCandidates.map(c => ({
        invoiceNumber: c._id,
        invoiceDate: c.invoiceDate,
        daysOverdue: Math.floor((now - c.invoiceDate.getTime()) / MS_PER_DAY),
        poNumber: c.poNumber,
        companyName: c.companyName,
    }));

    const total = countResult[0]?.count || 0;

    res.status(200).json(
        new ApiResponse(
            200,
            { invoices: results, total, page, size, totalPages: Math.ceil(total / size), thresholdDays },
            "Payment aging report fetched"
        )
    );
});

// ─── Manual resolution ───────────────────────────────────────────────────────

/**
 * Marks a row (or, if no invoiceNumber given, every UNMATCHED row on the
 * advice) as manually resolved — for cases a human has reviewed and closed
 * out (e.g. confirmed the UNMATCHED invoice number was a data-entry typo,
 * or accepted a SHORT_PAYMENT as intentional/already-chased).
 */
export const resolvePaymentAdviceRow = asyncHandler(async (req: Request, res: Response) => {
    const advice = await PaymentAdvice.findOne({ _id: req.params.id, isDeleted: false });
    if (!advice) throw new ApiError(404, "Payment advice not found");

    const invoiceNumber = req.body?.invoiceNumber as string | undefined;
    const targetRows = invoiceNumber
        ? advice.invoiceRows.filter(r => r.invoiceNumber === invoiceNumber)
        : advice.invoiceRows.filter(r => r.matchStatus === "UNMATCHED");

    if (targetRows.length === 0) {
        throw new ApiError(404, invoiceNumber ? `Row for invoice ${invoiceNumber} not found` : "No UNMATCHED rows to resolve");
    }

    const now = new Date();
    for (const row of targetRows) {
        row.manuallyResolved = true;
        row.manuallyResolvedAt = now;
    }

    await advice.save();

    res.status(200).json(
        new ApiResponse(200, { resolvedCount: targetRows.length }, "Row(s) marked as manually resolved")
    );
});
