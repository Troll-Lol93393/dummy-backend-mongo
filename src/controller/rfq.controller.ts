import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { RFQ } from "../models/rfq.models";

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

    const filter: Record<string, unknown> = { isDeleted: false };
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
        .sort({ [sortBy]: sortOrder })
        .skip((page - 1) * size)
        .limit(size);

    res.status(200).json(
        new ApiResponse(200, {
            data: rfqs,
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
    res.status(200).json(new ApiResponse(200, rfq, "RFQ fetched successfully"));
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

export const deleteRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const rfq = await RFQ.findByIdAndUpdate(rfqId, { isDeleted: true }, { new: true });
    res.status(200).json(new ApiResponse(200, rfq, "RFQ deleted successfully"));
});
