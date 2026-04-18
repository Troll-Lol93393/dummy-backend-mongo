import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { RFQ } from "../models/rfq.models";
import { Costing } from "../models/costing.model";
import { RFQItems } from "../models/rfqItems.model";
import { Email } from "../models/email.model";
import { discoverAribaDrawings } from "../services/email/aribaScraperService";
import { getEmailSettings } from "../models/emailSettings.model";
import { decryptPassword } from "../utils/emailEncryption";
import { uploadFileToCloudinary } from "../utils/cloudinary";
import fs from "fs";

export const createRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { prNumber, startDate, dueDate, ownerName, companyName, items, location } = req.body;

    if ([prNumber, startDate, dueDate, ownerName, companyName, location].some(value => !value || value?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    if (!items || items.length === 0) {
        throw new ApiError(400, "Atleast one item is required");
    }

    const newRFQ = await RFQ.create({
        prNumber,
        startDate,
        dueDate,
        ownerName,
        companyName,
        location,
        items,
        isQuoted: false,
        isDeleted: false,
        quotedOn: null,
        status: "PREVIEW",
        createdBy: req.user._id || "",
        updatedBy: req.user._id || "",
    });

    res.status(201).json(new ApiResponse(201, newRFQ, "RFQ created successfully"));
});

export const getRFQs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 10;
    const search = (req.query.search as string) || "";
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

    const isQuoted = req.query.isQuoted as string;
    const isRevised = req.query.isRevised as string;
    const isRegret = req.query.isRegret as string;

    const filter: Record<string, unknown> = { isDeleted: false };
    if (isQuoted === "true") filter.isQuoted = true;
    else if (isQuoted === "false") {
        filter.isQuoted = false;
        filter.isRegret = { $ne: true }; // Exclude regret RFQs from pending
    }
    if (isRevised === "true") filter.isRevised = true;
    if (isRegret === "true") filter.isRegret = true;

    if (search) {
        filter.$or = [
            { prNumber: { $regex: search, $options: "i" } },
            { companyName: { $regex: search, $options: "i" } },
            { ownerName: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
        ];
    }

    const totalCount = await RFQ.countDocuments(filter);
    const rfqs = await RFQ.find(filter)
        .populate("items", "_id")
        .sort({ [sortBy]: sortOrder })
        .skip((page - 1) * size)
        .limit(size)
        .lean();

    // Attach quotedItemCount to each RFQ
    const rfqIds = rfqs.map(r => r._id);
    const costings = await Costing.find({
        rfq: { $in: rfqIds },
        isDeleted: false,
    }).select("rfq rfqItem").lean();

    const costingCountByRfq = new Map<string, number>();
    for (const c of costings) {
        const key = String(c.rfq);
        costingCountByRfq.set(key, (costingCountByRfq.get(key) ?? 0) + 1);
    }

    // Count regretted items per RFQ
    const allRfqItemIds = rfqs.flatMap(r =>
        ((r.items as unknown as { _id: string }[]) ?? []).map(i =>
            typeof i === "object" ? String(i._id) : String(i)
        )
    );
    const regrettedItems = await RFQItems.find({
        _id: { $in: allRfqItemIds },
        isDeleted: false,
        isRegret: true,
    })
        .select("_id")
        .lean();
    const regrettedItemIdSet = new Set(regrettedItems.map(ri => String(ri._id)));

    const enriched = rfqs.map(r => {
        const itemIds = ((r.items as unknown as { _id: string }[]) ?? []).map(i =>
            typeof i === "object" ? String(i._id) : String(i)
        );
        const regrettedItemCount = itemIds.filter(id => regrettedItemIdSet.has(id)).length;
        return {
            ...r,
            quotedItemCount: costingCountByRfq.get(String(r._id)) ?? 0,
            regrettedItemCount,
        };
    });

    res.status(200).json(
        new ApiResponse(200, {
            data: enriched,
            totalCount,
            page,
            size,
            totalPages: Math.ceil(totalCount / size),
        }, "RFQs fetched successfully")
    );
});

export const getRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false }).populate({
        path: "items",
        match: { isDeleted: false },
        populate: [
            { path: "item" },
            { path: "itemTechSpecs" },
            { path: "commercialSpecs" },
        ],
    });

    if (!rfq) {
        throw new ApiError(404, "RFQ not found");
    }

    const rfqData = rfq.toObject() as unknown as Record<string, unknown>;
    const items = Array.isArray(rfqData.items) ? (rfqData.items as Array<Record<string, unknown>>) : [];
    rfqData.items = items.sort((a, b) =>
        compareSerialNumbers(String(a.serialNumber ?? ""), String(b.serialNumber ?? ""))
    );

    res.status(200).json(new ApiResponse(200, rfqData, "RFQ fetched successfully"));
});

export const updateRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const { prNumber, startDate, dueDate, ownerName, companyName, location, status, deliveryWeeks } =
        req.body;

    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
    if (!rfq) {
        throw new ApiError(404, "RFQ not found");
    }

    if (prNumber !== undefined) rfq.prNumber = prNumber;
    if (startDate !== undefined) rfq.startDate = startDate;
    if (dueDate !== undefined) rfq.dueDate = dueDate;
    if (ownerName !== undefined) rfq.ownerName = ownerName;
    if (companyName !== undefined) rfq.companyName = companyName;
    if (location !== undefined) rfq.location = location;
    if (status !== undefined) rfq.status = status;
    if (deliveryWeeks !== undefined) rfq.deliveryWeeks = deliveryWeeks;

    await rfq.save();

    res.status(200).json(new ApiResponse(200, rfq, "RFQ updated successfully"));
});

export const markAsQuoted = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;

    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
    if (!rfq) {
        throw new ApiError(404, "RFQ not found");
    }

    // Count non-deleted items and regretted items
    const rfqItemIds = (rfq.items as unknown as string[]) ?? [];
    const totalItems = await RFQItems.countDocuments({
        _id: { $in: rfqItemIds },
        isDeleted: false,
    });
    const regrettedCount = await RFQItems.countDocuments({
        _id: { $in: rfqItemIds },
        isDeleted: false,
        isRegret: true,
    });

    if (regrettedCount >= totalItems) {
        throw new ApiError(
            400,
            "All items are regretted. Use RFQ-level regret instead."
        );
    }

    // Remaining non-regretted items must all have costings
    const costingCount = await Costing.countDocuments({ rfq: rfq._id, isDeleted: false });
    const expectedCostings = totalItems - regrettedCount;
    if (costingCount === 0) {
        throw new ApiError(400, "Cannot mark as quoted — at least one item must have costing. Use 'Mark as Regret' instead.");
    }
    if (costingCount < expectedCostings) {
        throw new ApiError(
            400,
            `Cannot mark as quoted — ${expectedCostings - costingCount} non-regretted item(s) still need costing.`
        );
    }

    if (!rfq.isQuoted) {
        // First time quoting — assign quotation number
        const lastQuoted = await RFQ.findOne({ quotationNumber: { $exists: true, $ne: null } })
            .sort({ quotationNumber: -1 })
            .select("quotationNumber")
            .lean();
        const nextNumber = ((lastQuoted as { quotationNumber?: number })?.quotationNumber ?? 0) + 1;

        rfq.isQuoted = true;
        rfq.quotedOn = new Date();
        rfq.quotationNumber = nextNumber;
    } else {
        // Already quoted — mark as revised
        rfq.isRevised = true;
        rfq.revisionDate = new Date();
        rfq.quotedOn = new Date();
    }

    await rfq.save();

    res.status(200).json(new ApiResponse(200, rfq, "RFQ marked as quoted successfully"));
});

export const markAsRegret = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;

    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
    if (!rfq) {
        throw new ApiError(404, "RFQ not found");
    }

    rfq.isRegret = true;
    rfq.regretDate = new Date();

    await rfq.save();

    res.status(200).json(new ApiResponse(200, rfq, "RFQ marked as regret successfully"));
});

export const deleteRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const rfq = await RFQ.findByIdAndUpdate(rfqId, { isDeleted: true }, { new: true });
    res.status(200).json(new ApiResponse(200, rfq, "RFQ deleted successfully"));
});

export const getLinkedEmail = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const email = await Email.findOne({ linkedRfq: rfqId, isDeleted: false })
        .select("_id subject from date aribaLinks");
    res.status(200).json(new ApiResponse(200, email || null, email ? "Linked email found" : "No linked email"));
});

// POST /api/v1/rfq/backfill-document-urls
// One-time migration: copy downloadedDocUrl from linked emails to RFQs that have no documentUrl
export const backfillDocumentUrls = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const rfqsWithoutDoc = await RFQ.find({ isDeleted: false, documentUrl: { $exists: false } }).select("_id").lean();
    const rfqIds = rfqsWithoutDoc.map(r => r._id);

    if (rfqIds.length === 0) {
        res.status(200).json(new ApiResponse(200, { updated: 0, total: 0 }, "All RFQs already have documentUrl"));
        return;
    }

    const emails = await Email.find({
        linkedRfq: { $in: rfqIds },
        isDeleted: false,
        "aribaLinks.downloadStatus": "DOWNLOADED",
    }).select("linkedRfq aribaLinks attachments").lean();

    let updated = 0;
    for (const email of emails) {
        const ariba = email.aribaLinks?.find((l: { downloadedDocUrl?: string }) => l.downloadedDocUrl);
        const attachment = !ariba ? email.attachments?.find((a: { cloudinaryUrl?: string; contentType?: string }) => a.cloudinaryUrl && (a.contentType === "application/pdf" || a.contentType?.includes("word"))) : null;
        const docUrl = ariba?.downloadedDocUrl || attachment?.cloudinaryUrl;
        if (docUrl && email.linkedRfq) {
            await RFQ.findByIdAndUpdate(email.linkedRfq, { $set: { documentUrl: docUrl } });
            updated++;
        }
    }

    res.status(200).json(new ApiResponse(200, { updated, total: rfqIds.length }, `Backfilled documentUrl on ${updated} of ${rfqIds.length} RFQ(s)`));
});

// POST /api/v1/rfq/:rfqId/sync-drawings
// Manually trigger Ariba drawing discovery for an RFQ and sync results to it
export const syncDrawings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;

    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
    if (!rfq) throw new ApiError(404, "RFQ not found");

    const email = await Email.findOne({ linkedRfq: rfqId, isDeleted: false }).select("_id aribaLinks");
    if (!email || !email.aribaLinks || email.aribaLinks.length === 0) {
        throw new ApiError(404, "No linked email with Ariba links found for this RFQ");
    }

    const aribaLink = email.aribaLinks.find((l: { url?: string }) => l.url);
    if (!aribaLink?.url) throw new ApiError(404, "No Ariba URL found on linked email");

    const settings = await getEmailSettings();
    if (!settings.aribaUsername || !settings.aribaPassword) {
        throw new ApiError(500, "Ariba credentials not configured in Email Settings");
    }

    const aribaPassword = decryptPassword(settings.aribaPassword);
    const result = await discoverAribaDrawings(aribaLink.url, settings.aribaUsername, aribaPassword);

    const uploadedDrawings: { url: string; filename: string }[] = [];
    for (const drawing of result.drawings) {
        if (fs.existsSync(drawing.filePath)) {
            try {
                const cloudResult = await uploadFileToCloudinary(drawing.filePath);
                if (cloudResult?.secure_url) {
                    uploadedDrawings.push({ url: cloudResult.secure_url, filename: drawing.filename });
                }
            } catch { /* non-critical */ }
        }
    }

    // Cleanup temp dirs
    if (fs.existsSync(result.downloadDir)) {
        fs.rmSync(result.downloadDir, { recursive: true, force: true });
    }
    if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
        try { fs.unlinkSync(result.screenshotPath); } catch { /* ignore */ }
    }

    if (uploadedDrawings.length > 0) {
        await RFQ.findByIdAndUpdate(rfqId, { $set: { drawings: uploadedDrawings } });
        // Also persist on the email's ariba link
        aribaLink.drawings = uploadedDrawings;
        await email.save();
    }

    res.status(200).json(
        new ApiResponse(
            200,
            { drawings: uploadedDrawings, candidateLinks: result.candidateLinks },
            uploadedDrawings.length > 0
                ? `Synced ${uploadedDrawings.length} drawing(s) to RFQ`
                : `No drawings found (${result.candidateLinks.length} candidate link(s) on page)`
        )
    );
});

function compareSerialNumbers(a: string, b: string): number {
    const partsA = a.split(".").map(p => parseInt(p, 10) || 0);
    const partsB = b.split(".").map(p => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}
