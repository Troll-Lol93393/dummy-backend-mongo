import mongoose, { Schema } from "mongoose";

/**
 * Lightweight per-invoice tracking for the 45-day-overdue follow-up draft
 * cadence. This is intentionally separate from PaymentAdvice — an overdue,
 * never-paid invoice has no PaymentAdvice document at all (nothing has been
 * received against it yet), so there's nowhere on that model to record when
 * the last "payment not received" draft was created. One doc per invoice
 * number, upserted idempotently.
 */
export interface IInvoiceFollowUpTracking {
    invoiceNumber: string;
    lastDraftedAt: Date;
    draftCount: number;
    lastDraftMessageId?: string;
    // Set once the invoice is confirmed paid (a PaymentAdvice row now exists
    // for it) so the weekly re-draft loop stops picking it up.
    resolved: boolean;
    resolvedAt?: Date;
}

const invoiceFollowUpTrackingSchema = new Schema<IInvoiceFollowUpTracking>(
    {
        invoiceNumber: {
            type: String,
            required: [true, "Invoice number is required"],
            unique: true,
            trim: true,
            index: true,
        },
        lastDraftedAt: { type: Date, required: true },
        draftCount: { type: Number, default: 0 },
        lastDraftMessageId: { type: String },
        resolved: { type: Boolean, default: false },
        resolvedAt: { type: Date },
    },
    { timestamps: true }
);

export const InvoiceFollowUpTracking = mongoose.model<IInvoiceFollowUpTracking>(
    "InvoiceFollowUpTracking",
    invoiceFollowUpTrackingSchema
);
