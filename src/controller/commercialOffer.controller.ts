import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { ApiResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { RFQ } from "../models/rfq.models";
import { Costing } from "../models/costing.model";
import { CommercialOffer, ICommercialSnapshot } from "../models/commercialOffer.model";
import { generateCommercialOfferPdf } from "../services/commercialOffer/generatePdf";
import { generateCommercialOfferExcel } from "../services/commercialOffer/generateExcel";
import { getCompanyProfileForGenerators } from "./companyProfile.controller";

// ── Constants ──
const HSN_CODE = "84879000";
const GST_PERCENT = 18;

// ── Build snapshot from RFQ + costings ──

interface PopulatedCostingItem {
    _id: string;
    serialNumber?: string;
    item: { itemCode: string; itemName: string };
    quantity: number;
    itemTechSpecs?: { material?: string };
}

async function buildCommercialSnapshot(rfqId: string): Promise<ICommercialSnapshot> {
    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false })
        .populate({
            path: "items",
            match: { isDeleted: false },
            populate: [{ path: "item" }, { path: "itemTechSpecs" }],
        })
        .lean();

    if (!rfq) throw new ApiError(404, "RFQ not found");

    const costings = await Costing.find({ rfq: rfqId, isDeleted: false }).lean();
    const costingMap = new Map<string, { sellingPrice: number }>();
    costings.forEach(c => {
        costingMap.set(c.rfqItem.toString(), { sellingPrice: c.sellingPrice });
    });

    const lineItems = (rfq.items as unknown as PopulatedCostingItem[]) ?? [];

    let grandTotalBeforeGst = 0;
    let grandGstAmount = 0;
    let grandTotalWithGst = 0;

    const items = lineItems
        .filter(li => li.item)
        .map((li, idx) => {
            const costing = costingMap.get(li._id.toString());
            const sellingPrice = costing?.sellingPrice ?? 0;
            const quantity = li.quantity ?? 1;
            const totalBeforeGst = sellingPrice * quantity;
            const gstAmount = Math.round(((totalBeforeGst * GST_PERCENT) / 100) * 100) / 100;
            const totalWithGst = Math.round((totalBeforeGst + gstAmount) * 100) / 100;

            grandTotalBeforeGst += totalBeforeGst;
            grandGstAmount += gstAmount;
            grandTotalWithGst += totalWithGst;

            return {
                serialNumber: li.serialNumber || String(idx + 1),
                itemCode: li.item.itemCode,
                itemName: li.item.itemName,
                material: (li.itemTechSpecs as { material?: string } | undefined)?.material ?? "",
                quantity,
                sellingPrice,
                hsnCode: HSN_CODE,
                gstPercent: GST_PERCENT,
                totalBeforeGst,
                gstAmount,
                totalWithGst,
            };
        });

    return {
        prNumber: rfq.prNumber,
        companyName: rfq.companyName,
        location: rfq.location,
        ownerName: rfq.ownerName ?? "",
        deliveryWeeks: rfq.deliveryWeeks ?? 0,
        items,
        grandTotalBeforeGst: Math.round(grandTotalBeforeGst * 100) / 100,
        grandGstAmount: Math.round(grandGstAmount * 100) / 100,
        grandTotalWithGst: Math.round(grandTotalWithGst * 100) / 100,
    };
}

// ══════════════════════════════════════════════
// 1. GENERATE — creates a new version (DRAFT)
// ══════════════════════════════════════════════

export const generateCommercialOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;

        const snapshot = await buildCommercialSnapshot(rfqId);

        // Next version
        const latest = await CommercialOffer.findOne({ rfq: rfqId }).sort({ version: -1 }).lean();
        const nextVersion = latest ? latest.version + 1 : 1;

        // Supersede old non-approved drafts
        await CommercialOffer.updateMany(
            { rfq: rfqId, status: { $nin: ["SUPERSEDED", "APPROVED"] } },
            { $set: { status: "SUPERSEDED" } }
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (req as any).user?._id;
        const offer = await CommercialOffer.create({
            rfq: rfqId,
            version: nextVersion,
            status: "DRAFT",
            snapshot,
            generatedBy: userId,
        });

        await RFQ.findByIdAndUpdate(rfqId, { activeCommercialOffer: offer._id });

        res.status(201).json(new ApiResponse(201, offer, "Commercial offer generated"));
    }
);

// ══════════════════════════════════════════════
// 2. SUBMIT
// ══════════════════════════════════════════════

export const submitCommercialOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;

        const offer = await CommercialOffer.findById(offerId);
        if (!offer) throw new ApiError(404, "Commercial offer not found");
        if (offer.status !== "DRAFT")
            throw new ApiError(400, `Cannot submit with status "${offer.status}"`);

        offer.status = "SUBMITTED";
        offer.submittedAt = new Date();
        await offer.save();

        res.status(200).json(new ApiResponse(200, offer, "Commercial offer submitted"));
    }
);

// ══════════════════════════════════════════════
// 3. REVIEW — approve or request revisions
// ══════════════════════════════════════════════

export const reviewCommercialOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;
        const { action, reviewRemarks, changeRequests, approvedBy } = req.body;

        const offer = await CommercialOffer.findById(offerId);
        if (!offer) throw new ApiError(404, "Commercial offer not found");
        if (!["SUBMITTED", "UNDER_REVIEW"].includes(offer.status)) {
            throw new ApiError(400, `Cannot review with status "${offer.status}"`);
        }

        if (action === "approve") {
            offer.status = "APPROVED";
            offer.approvedBy = approvedBy ?? "";
            offer.approvedAt = new Date();
            offer.reviewedAt = new Date();
            if (reviewRemarks) offer.reviewRemarks = reviewRemarks;

            await CommercialOffer.updateMany(
                { rfq: offer.rfq, _id: { $ne: offer._id }, status: { $ne: "SUPERSEDED" } },
                { $set: { status: "SUPERSEDED" } }
            );
            await RFQ.findByIdAndUpdate(offer.rfq, { activeCommercialOffer: offer._id });
        } else if (action === "request_revision") {
            offer.status = "REVISION_REQUESTED";
            offer.reviewedAt = new Date();
            if (reviewRemarks) offer.reviewRemarks = reviewRemarks;
            if (Array.isArray(changeRequests)) offer.changeRequests = changeRequests;
        } else {
            throw new ApiError(400, "Action must be 'approve' or 'request_revision'");
        }

        await offer.save();
        res.status(200).json(
            new ApiResponse(
                200,
                offer,
                `Commercial offer ${action === "approve" ? "approved" : "revision requested"}`
            )
        );
    }
);

// ══════════════════════════════════════════════
// 4. RESOLVE CHANGE REQUEST
// ══════════════════════════════════════════════

export const resolveCommercialChangeRequest = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;
        const changeRequestId = req.params.changeRequestId!;

        const offer = await CommercialOffer.findById(offerId);
        if (!offer) throw new ApiError(404, "Commercial offer not found");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cr = offer.changeRequests.find(c => (c as any)._id?.toString() === changeRequestId);
        if (!cr) throw new ApiError(404, "Change request not found");

        cr.resolved = true;
        await offer.save();

        res.status(200).json(new ApiResponse(200, offer, "Change request resolved"));
    }
);

// ══════════════════════════════════════════════
// 5. GET HISTORY
// ══════════════════════════════════════════════

export const getCommercialOfferHistory = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;

        const offers = await CommercialOffer.find({ rfq: rfqId })
            .sort({ version: -1 })
            .populate("generatedBy", "name email")
            .lean();

        res.status(200).json(new ApiResponse(200, offers, "Commercial offer history fetched"));
    }
);

// ══════════════════════════════════════════════
// 6. GET SINGLE
// ══════════════════════════════════════════════

export const getCommercialOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;

        const offer = await CommercialOffer.findById(offerId)
            .populate("generatedBy", "name email")
            .lean();

        if (!offer) throw new ApiError(404, "Commercial offer not found");
        res.status(200).json(new ApiResponse(200, offer, "Commercial offer fetched"));
    }
);

// ══════════════════════════════════════════════
// 7. DOWNLOAD PDF
// ══════════════════════════════════════════════

export const downloadCommercialOfferPdf = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;
        const { offerId } = req.query;

        let data: ICommercialSnapshot;

        if (offerId && typeof offerId === "string") {
            const offer = await CommercialOffer.findById(offerId).lean();
            if (!offer) throw new ApiError(404, "Commercial offer not found");
            data = offer.snapshot;
        } else {
            data = await buildCommercialSnapshot(rfqId);
        }

        const company = await getCompanyProfileForGenerators();
        const pdfStream = generateCommercialOfferPdf(data, company);

        const filename = `Commercial_Offer_${data.prNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        pdfStream.pipe(res);
    }
);

// ══════════════════════════════════════════════
// 8. DOWNLOAD EXCEL
// ══════════════════════════════════════════════

export const downloadCommercialOfferExcel = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;
        const { offerId } = req.query;

        let data: ICommercialSnapshot;

        if (offerId && typeof offerId === "string") {
            const offer = await CommercialOffer.findById(offerId).lean();
            if (!offer) throw new ApiError(404, "Commercial offer not found");
            data = offer.snapshot;
        } else {
            data = await buildCommercialSnapshot(rfqId);
        }

        const company = await getCompanyProfileForGenerators();
        const buffer = await generateCommercialOfferExcel(data, company);

        const filename = `Commercial_Offer_${data.prNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}.xlsx`;
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        res.send(buffer);
    }
);
