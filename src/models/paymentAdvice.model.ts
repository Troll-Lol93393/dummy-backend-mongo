import mongoose, { Schema } from "mongoose";

export type PaymentAdviceRowMatchStatus = "MATCHED" | "SHORT_PAYMENT" | "UNMATCHED";

export type FollowUpDraftStatus = "DRAFTED" | "SENT";

export interface IPaymentAdviceInvoiceRow {
    invoiceNumber: string;
    docDate: Date;
    // Bank payment doc no — this is the customer's own payment reference
    // (e.g. "2300008725"), shared across every row in the same advice.
    bankPaymentDocNo: string;
    invoiceTotalAmount: number;
    tdsAmount: number;
    retentionAmount: number;
    otherHoldAmount: number;
    previousPaidAmount: number;
    // invoiceTotalAmount - tdsAmount. TDS is the only legitimate deduction —
    // retention/other-hold amounts are NOT subtracted here (see matching
    // rule in paymentMatchingService.ts); they surface as a shortfall
    // instead, through the actual-vs-expected comparison.
    expectedNet: number;
    // This advice's actual credited amount attributed to this row
    // (proportional share of the header amount — see paymentMatchingService).
    // Left undefined when matchStatus is UNMATCHED (never guessed).
    actualAllocated?: number;
    matchStatus: PaymentAdviceRowMatchStatus;
    shortfallAmount?: number;
    // Set when the PDF's stated previousPaidAmount didn't reasonably match
    // (tolerance ₹5) what this system has already recorded as received for
    // this invoice from prior PaymentAdvice rows. The PDF's value is still
    // used for the calculation — this only flags it for manual review.
    previousPaidReconciliationMismatch?: boolean;
    // Outbound short-payment-query draft tracking (idempotency + audit).
    followUpDraftStatus?: FollowUpDraftStatus;
    followUpDraftedAt?: Date;
    // Manual resolution — set via PATCH /api/v1/payment/advices/:id/resolve
    manuallyResolved?: boolean;
    manuallyResolvedAt?: Date;
}

export interface IPaymentAdvice {
    email: mongoose.Types.ObjectId;
    utrNo: string;
    amount: number;
    paymentDate: Date;
    // Unique — stable per advice, used as the idempotent upsert key so
    // re-processing the same email (or a re-synced copy of it) never creates
    // duplicate reconciliation records.
    cmpReferenceNo: string;
    payerCompanyName: string;
    invoiceRows: IPaymentAdviceInvoiceRow[];
    // Full extracted PDF text, kept for audit/debugging when a parse looks
    // suspicious or a row needs manual verification.
    rawPdfText: string;
    isDeleted: boolean;
}

const paymentAdviceInvoiceRowSchema = new Schema<IPaymentAdviceInvoiceRow>(
    {
        invoiceNumber: { type: String, required: true, trim: true, index: true },
        docDate: { type: Date, required: true },
        bankPaymentDocNo: { type: String, default: "", trim: true },
        invoiceTotalAmount: { type: Number, default: 0 },
        tdsAmount: { type: Number, default: 0 },
        retentionAmount: { type: Number, default: 0 },
        otherHoldAmount: { type: Number, default: 0 },
        previousPaidAmount: { type: Number, default: 0 },
        expectedNet: { type: Number, default: 0 },
        actualAllocated: { type: Number },
        matchStatus: {
            type: String,
            enum: ["MATCHED", "SHORT_PAYMENT", "UNMATCHED"],
            default: "UNMATCHED",
        },
        shortfallAmount: { type: Number },
        previousPaidReconciliationMismatch: { type: Boolean, default: false },
        followUpDraftStatus: { type: String, enum: ["DRAFTED", "SENT"] },
        followUpDraftedAt: { type: Date },
        manuallyResolved: { type: Boolean, default: false },
        manuallyResolvedAt: { type: Date },
    },
    { _id: true }
);

const paymentAdviceSchema = new Schema<IPaymentAdvice>(
    {
        email: { type: Schema.Types.ObjectId, ref: "Email", required: true, index: true },
        utrNo: { type: String, required: true, trim: true },
        amount: { type: Number, required: true },
        paymentDate: { type: Date, required: true },
        cmpReferenceNo: {
            type: String,
            required: [true, "CMP reference number is required"],
            unique: true,
            trim: true,
            index: true,
        },
        payerCompanyName: { type: String, default: "", trim: true },
        invoiceRows: [paymentAdviceInvoiceRowSchema],
        rawPdfText: { type: String, default: "" },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true }
);

paymentAdviceSchema.index({ "invoiceRows.matchStatus": 1 });
paymentAdviceSchema.index({ "invoiceRows.invoiceNumber": 1 });

export const PaymentAdvice = mongoose.model<IPaymentAdvice>("PaymentAdvice", paymentAdviceSchema);
