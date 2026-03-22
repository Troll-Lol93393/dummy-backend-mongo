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
    const rfqs = await RFQ.find({ isDeleted: false });
    res.status(200).json(new ApiResponse(200, rfqs, "RFQs fetched successfully"));
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
