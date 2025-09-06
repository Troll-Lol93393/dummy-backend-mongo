import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/apiResponse";
import { RFQ } from "../../models/rfq.models";

export const createRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { number, startDate, dueDate, ownerName, companyName, items, location } = req.body;

    if ([number, startDate, dueDate, ownerName, companyName, items, location ].some(value => !value || value?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    if (!items || items.length === 0) {
        throw new ApiError(400, "Items are required");
    }

    const newRFQ = await RFQ.create({
        number,
        startDate,
        dueDate,
        ownerName,
        companyName,
        location,
        items,
        isQuoted: false,
        isDeleted: false,
        quotedOn: null,
        status: "ACCEPTING_RESPONSE",
        createdBy: req.user._id,
        updatedBy: req.user._id,
    });

    res.status(201).json(new ApiResponse(201, newRFQ, "RFQ created successfully"));
});

export const getRFQs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const rfqs = await RFQ.find({ isDeleted: false });
    res.status(200).json(new ApiResponse(200, rfqs, "RFQs fetched successfully"));
});

export const getRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const rfq = await RFQ.findById(rfqId, { isDeleted: false });
    if (!rfq) {
        throw new ApiError(404, "RFQ not found");
    }
    res.status(200).json(new ApiResponse(200, rfq, "RFQ fetched successfully"));
});

export const deleteRFQ = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqId } = req.params;
    const rfq = await RFQ.findByIdAndUpdate(rfqId, { isDeleted: true }, { new: true });
    res.status(200).json(new ApiResponse(200, rfq, "RFQ deleted successfully"));
});
