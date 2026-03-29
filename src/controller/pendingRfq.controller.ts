import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { RFQ } from "../models/rfq.models";

type Urgency = "overdue" | "today" | "tomorrow" | "soon" | "normal";

interface PendingRfqRow {
    _id: string;
    prNumber: string;
    companyName: string;
    ownerName: string;
    location: string;
    dueDate: Date;
    startDate: Date;
    status: string;
    itemCount: number;
    daysRemaining: number;
    urgency: Urgency;
    isReviewed: boolean;
}

const getUrgency = (daysRemaining: number): Urgency => {
    if (daysRemaining < 0) return "overdue";
    if (daysRemaining === 0) return "today";
    if (daysRemaining === 1) return "tomorrow";
    if (daysRemaining <= 3) return "soon";
    return "normal";
};

export const getPendingSummary = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const period = (req.query.period as string) || "all";

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

        const filter: Record<string, unknown> = {
            status: { $in: ["ACCEPTING_RESPONSE", "PREVIEW"] },
            isDeleted: false,
        };

        if (period === "today") {
            filter.dueDate = { $lte: endOfToday };
        } else if (period === "week") {
            const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
            filter.dueDate = { $lte: endOfWeek };
        }
        // "all" — no date cap

        const rawRfqs = await RFQ.find(filter)
            .populate("items", "_id")
            .sort({ dueDate: 1 })
            .lean();

        const rfqs: PendingRfqRow[] = rawRfqs.map(rfq => {
            const dueDate = new Date(rfq.dueDate);
            const diffMs = dueDate.getTime() - startOfToday.getTime();
            const daysRemaining = Math.floor(diffMs / (24 * 60 * 60 * 1000));

            return {
                _id: String(rfq._id),
                prNumber: rfq.prNumber,
                companyName: rfq.companyName,
                ownerName: rfq.ownerName,
                location: rfq.location,
                dueDate: rfq.dueDate,
                startDate: rfq.startDate,
                status: rfq.status,
                itemCount: rfq.items?.length ?? 0,
                daysRemaining,
                urgency: getUrgency(daysRemaining),
                isReviewed: rfq.isReviewed ?? false,
            };
        });

        const counts = {
            overdue: rfqs.filter(r => r.urgency === "overdue").length,
            dueToday: rfqs.filter(r => r.urgency === "today").length,
            dueThisWeek: rfqs.filter(r => r.daysRemaining >= 0 && r.daysRemaining <= 7).length,
            total: rfqs.length,
        };

        res.status(200).json(
            new ApiResponse(200, { rfqs, counts }, "Pending RFQ summary fetched successfully")
        );
    }
);

export const markReviewed = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { rfqId } = req.params;

        const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
        if (!rfq) {
            throw new ApiError(404, "RFQ not found");
        }

        rfq.isReviewed = true;
        await rfq.save();

        res.status(200).json(new ApiResponse(200, rfq, "RFQ marked as reviewed"));
    }
);
