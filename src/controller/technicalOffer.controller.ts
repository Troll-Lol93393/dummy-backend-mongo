import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { ApiResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { RFQ } from "../models/rfq.models";
import { TechnicalOffer, ISnapshot } from "../models/technicalOffer.model";
import { generateTechOfferPdf } from "../services/technicalOffer/generatePdf";
import { generateTechOfferExcel } from "../services/technicalOffer/generateExcel";

// ── Populated-doc helper interfaces ──

interface PopulatedHardness {
    hardnessType: string;
    value: string;
    measurement: string;
}

interface PopulatedTechSpecs {
    material?: string;
    grade?: string;
    remarks?: string;
    hardness?: PopulatedHardness[];
}

interface PopulatedBomEntry {
    partName: string;
    partDescription?: string;
    material?: string;
    quantity: number;
    diameter?: string;
    length?: string;
    weight?: string;
    density?: string;
    grade?: string;
    make?: string;
    remarks?: string;
    hardness?: PopulatedHardness[];
}

interface PopulatedItem {
    itemCode: string;
    itemName: string;
    itemDesc: string;
    itemType: string;
    bom?: PopulatedBomEntry[];
}

interface PopulatedRfqItem {
    serialNumber?: string;
    item: PopulatedItem;
    quantity: number;
    drawingNumber?: string;
    itemTechSpecs?: PopulatedTechSpecs;
    isDeleted: boolean;
}

// ── Build snapshot from populated RFQ ──

function buildSnapshotFromRfq(rfq: Record<string, unknown>): ISnapshot {
    const lineItems = (rfq.items as PopulatedRfqItem[]) ?? [];

    const items = lineItems
        .filter(li => !li.isDeleted && li.item)
        .map((li, idx) => {
            const item = li.item;
            const techSpecs = li.itemTechSpecs;
            const isSetOrAssembly = item.itemType === "SET" || item.itemType === "ASSEMBLY";

            return {
                serialNumber: li.serialNumber || String(idx + 1),
                itemCode: item.itemCode,
                itemName: item.itemName,
                itemDesc: item.itemDesc,
                itemType: item.itemType,
                quantity: li.quantity,
                drawingNumber: li.drawingNumber ?? "",
                material: techSpecs?.material ?? "",
                grade: techSpecs?.grade ?? "",
                hardness: (techSpecs?.hardness ?? []).map(h => ({
                    hardnessType: h.hardnessType,
                    value: h.value,
                    measurement: h.measurement,
                })),
                remarks: techSpecs?.remarks ?? "",
                bom: isSetOrAssembly
                    ? (item.bom ?? []).map(b => ({
                          partName: b.partName,
                          material: b.material ?? "",
                          grade: b.grade ?? "",
                          quantity: b.quantity,
                          hardness: (b.hardness ?? []).map(h => ({
                              hardnessType: h.hardnessType,
                              value: h.value,
                              measurement: h.measurement,
                          })),
                          remarks: b.remarks ?? "",
                      }))
                    : [],
            };
        });

    return {
        prNumber: rfq.prNumber as string,
        companyName: rfq.companyName as string,
        location: rfq.location as string,
        ownerName: (rfq.ownerName as string) ?? "",
        deliveryWeeks: (rfq.deliveryWeeks as number) ?? 0,
        items,
    };
}

// Helper: fetch & populate an RFQ
async function fetchPopulatedRfq(rfqId: string | undefined) {
    if (!rfqId) throw new ApiError(400, "RFQ ID is required");
    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false })
        .populate({
            path: "items",
            match: { isDeleted: false },
            populate: [{ path: "item" }, { path: "itemTechSpecs" }],
        })
        .lean();

    if (!rfq) throw new ApiError(404, "RFQ not found");
    return rfq;
}

// ══════════════════════════════════════════════
// 1. GENERATE — creates a new version (DRAFT)
// ══════════════════════════════════════════════

export const generateTechOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;
        const rfq = await fetchPopulatedRfq(rfqId);

        // Determine next version number
        const latestOffer = await TechnicalOffer.findOne({ rfq: rfqId })
            .sort({ version: -1 })
            .lean();
        const nextVersion = latestOffer ? latestOffer.version + 1 : 1;

        // Mark previous non-superseded versions as SUPERSEDED
        await TechnicalOffer.updateMany(
            { rfq: rfqId, status: { $nin: ["SUPERSEDED", "APPROVED"] } },
            { $set: { status: "SUPERSEDED" } }
        );

        // Build snapshot
        const snapshot = buildSnapshotFromRfq(rfq as unknown as Record<string, unknown>);

        // Create new technical offer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userId = (req as any).user?._id;
        const offer = await TechnicalOffer.create({
            rfq: rfqId,
            version: nextVersion,
            status: "DRAFT",
            snapshot,
            generatedBy: userId,
        });

        // Update RFQ's active technical offer
        await RFQ.findByIdAndUpdate(rfqId, { activeTechnicalOffer: offer._id });

        res.status(201).json(new ApiResponse(201, offer, "Technical offer generated"));
    }
);

// ══════════════════════════════════════════════
// 2. SUBMIT — mark as submitted to client portal
// ══════════════════════════════════════════════

export const submitTechOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;

        const offer = await TechnicalOffer.findById(offerId);
        if (!offer) throw new ApiError(404, "Technical offer not found");

        if (offer.status !== "DRAFT") {
            throw new ApiError(400, `Cannot submit an offer with status "${offer.status}"`);
        }

        offer.status = "SUBMITTED";
        offer.submittedAt = new Date();
        await offer.save();

        res.status(200).json(new ApiResponse(200, offer, "Technical offer submitted"));
    }
);

// ══════════════════════════════════════════════
// 3. REVIEW — approve or request revisions
// ══════════════════════════════════════════════

export const reviewTechOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;
        const { action, reviewRemarks, changeRequests, approvedBy } = req.body;

        const offer = await TechnicalOffer.findById(offerId);
        if (!offer) throw new ApiError(404, "Technical offer not found");

        if (!["SUBMITTED", "UNDER_REVIEW"].includes(offer.status)) {
            throw new ApiError(400, `Cannot review an offer with status "${offer.status}"`);
        }

        if (action === "approve") {
            offer.status = "APPROVED";
            offer.approvedBy = approvedBy ?? "";
            offer.approvedAt = new Date();
            offer.reviewedAt = new Date();
            if (reviewRemarks) offer.reviewRemarks = reviewRemarks;

            // Mark all other versions for this RFQ as SUPERSEDED
            await TechnicalOffer.updateMany(
                { rfq: offer.rfq, _id: { $ne: offer._id }, status: { $ne: "SUPERSEDED" } },
                { $set: { status: "SUPERSEDED" } }
            );

            // Set as active on RFQ
            await RFQ.findByIdAndUpdate(offer.rfq, { activeTechnicalOffer: offer._id });
        } else if (action === "request_revision") {
            offer.status = "REVISION_REQUESTED";
            offer.reviewedAt = new Date();
            if (reviewRemarks) offer.reviewRemarks = reviewRemarks;
            if (Array.isArray(changeRequests)) {
                offer.changeRequests = changeRequests;
            }
        } else {
            throw new ApiError(400, "Action must be 'approve' or 'request_revision'");
        }

        await offer.save();

        res.status(200).json(new ApiResponse(200, offer, `Technical offer ${action === "approve" ? "approved" : "revision requested"}`));
    }
);

// ══════════════════════════════════════════════
// 4. RESOLVE CHANGE REQUEST
// ══════════════════════════════════════════════

export const resolveChangeRequest = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;
        const changeRequestId = req.params.changeRequestId!;

        const offer = await TechnicalOffer.findById(offerId);
        if (!offer) throw new ApiError(404, "Technical offer not found");

        const cr = offer.changeRequests.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c => (c as any)._id?.toString() === changeRequestId
        );
        if (!cr) throw new ApiError(404, "Change request not found");

        cr.resolved = true;
        await offer.save();

        res.status(200).json(new ApiResponse(200, offer, "Change request resolved"));
    }
);

// ══════════════════════════════════════════════
// 5. GET VERSION HISTORY for an RFQ
// ══════════════════════════════════════════════

export const getTechOfferHistory = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;

        const offers = await TechnicalOffer.find({ rfq: rfqId })
            .sort({ version: -1 })
            .populate("generatedBy", "name email")
            .lean();

        res.status(200).json(new ApiResponse(200, offers, "Technical offer history fetched"));
    }
);

// ══════════════════════════════════════════════
// 6. GET SINGLE OFFER
// ══════════════════════════════════════════════

export const getTechOffer = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const offerId = req.params.offerId!;

        const offer = await TechnicalOffer.findById(offerId)
            .populate("generatedBy", "name email")
            .lean();

        if (!offer) throw new ApiError(404, "Technical offer not found");

        res.status(200).json(new ApiResponse(200, offer, "Technical offer fetched"));
    }
);

// ══════════════════════════════════════════════
// 7. DOWNLOAD PDF (from snapshot or live data)
// ══════════════════════════════════════════════

export const downloadTechOfferPdf = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;
        const { offerId } = req.query;

        let data: ISnapshot;

        if (offerId && typeof offerId === "string") {
            // Download from a specific version's snapshot
            const offer = await TechnicalOffer.findById(offerId).lean();
            if (!offer) throw new ApiError(404, "Technical offer not found");
            data = offer.snapshot;
        } else {
            // Download live from current RFQ data
            const rfq = await fetchPopulatedRfq(rfqId);
            data = buildSnapshotFromRfq(rfq as unknown as Record<string, unknown>);
        }

        const pdfStream = generateTechOfferPdf(data);

        const filename = `Technical_Offer_${data.prNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        pdfStream.pipe(res);
    }
);

// ══════════════════════════════════════════════
// 8. DOWNLOAD EXCEL (from snapshot or live data)
// ══════════════════════════════════════════════

export const downloadTechOfferExcel = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;
        const { offerId } = req.query;

        let data: ISnapshot;

        if (offerId && typeof offerId === "string") {
            const offer = await TechnicalOffer.findById(offerId).lean();
            if (!offer) throw new ApiError(404, "Technical offer not found");
            data = offer.snapshot;
        } else {
            const rfq = await fetchPopulatedRfq(rfqId);
            data = buildSnapshotFromRfq(rfq as unknown as Record<string, unknown>);
        }

        const buffer = await generateTechOfferExcel(data);

        const filename = `Technical_Offer_${data.prNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}.xlsx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        res.send(buffer);
    }
);
