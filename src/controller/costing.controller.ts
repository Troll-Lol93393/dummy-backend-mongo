import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Costing } from "../models/costing.model";
import { RFQItems } from "../models/rfqItems.model";
import { RFQ } from "../models/rfq.models";

export const createOrUpdateCosting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;

        if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
            throw new ApiError(400, "Invalid RFQ Item ID");
        }

        const rfqItem = await RFQItems.findOne({ _id: rfqItemId, isDeleted: false });
        if (!rfqItem) {
            throw new ApiError(404, "RFQ Item not found");
        }

        // Find the RFQ that contains this item
        const rfq = await RFQ.findOne({ items: rfqItemId, isDeleted: false });
        if (!rfq) {
            throw new ApiError(404, "RFQ not found for this item");
        }

        const {
            diameter = 0,
            length = 0,
            density = 7.85,
            materialRate = 0,
            rawMaterialParty,
            labourEntries = [],
            profitMargin = 0,
            packingCost = 0,
            shippingCost = 0,
            otherCosts = 0,
        } = req.body;

        // Weight calculation (cylinder volume * density)
        const weight =
            (Math.PI * Math.pow(diameter / 2, 2) * length * density) / 1000000;

        // Raw material cost
        const rawMaterialCost = weight * materialRate;

        // Labour costs
        const processedLabourEntries = labourEntries.map((entry: any) => ({
            ...entry,
            cost: entry.rateType === "PER_KG" ? entry.rate * weight : entry.rate,
        }));
        const totalLabourCost = processedLabourEntries.reduce(
            (sum: number, e: any) => sum + (e.cost as number),
            0
        );

        // Pricing
        const costPrice = rawMaterialCost + totalLabourCost;
        const profitAmount = (costPrice * profitMargin) / 100;
        const sellingPrice =
            costPrice + profitAmount + packingCost + shippingCost + otherCosts;
        const totalCost = sellingPrice * (rfqItem.quantity ?? 1);

        const costingData = {
            rfqItem: new mongoose.Types.ObjectId(rfqItemId),
            rfq: rfq._id,
            diameter,
            length,
            density,
            weight,
            materialRate,
            rawMaterialParty: rawMaterialParty
                ? new mongoose.Types.ObjectId(rawMaterialParty as string)
                : undefined,
            rawMaterialCost,
            labourEntries: processedLabourEntries,
            totalLabourCost,
            costPrice,
            profitMargin,
            profitAmount,
            packingCost,
            shippingCost,
            otherCosts,
            sellingPrice,
            totalCost,
        };

        const costing = await Costing.findOneAndUpdate(
            { rfqItem: rfqItemId, isDeleted: false },
            { $set: costingData },
            { upsert: true, new: true }
        );

        // Update RFQ isQuoted status
        await RFQ.findByIdAndUpdate(rfq._id, {
            isQuoted: true,
            quotedOn: new Date(),
        });

        res.status(200).json(
            new ApiResponse(200, costing, "Costing saved successfully")
        );
    }
);

export const getCosting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;

        if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
            throw new ApiError(400, "Invalid RFQ Item ID");
        }

        const costing = await Costing.findOne({
            rfqItem: rfqItemId,
            isDeleted: false,
        })
            .populate("rawMaterialParty", "acName")
            .populate("labourEntries.labourProcessType", "name")
            .populate("labourEntries.party", "acName");

        if (!costing) {
            throw new ApiError(404, "Costing not found for this RFQ item");
        }

        res.status(200).json(
            new ApiResponse(200, costing, "Costing fetched successfully")
        );
    }
);

export const getCostingsByRfq = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqId } = req.params;

        if (!rfqId || !mongoose.Types.ObjectId.isValid(rfqId)) {
            throw new ApiError(400, "Invalid RFQ ID");
        }

        const costings = await Costing.find({
            rfq: rfqId,
            isDeleted: false,
        })
            .populate({
                path: "rfqItem",
                populate: { path: "item" },
            })
            .populate("rawMaterialParty", "acName")
            .populate("labourEntries.labourProcessType", "name")
            .populate("labourEntries.party", "acName");

        res.status(200).json(
            new ApiResponse(200, costings, "Costings fetched successfully")
        );
    }
);

export const deleteCosting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;

        if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
            throw new ApiError(400, "Invalid RFQ Item ID");
        }

        const costing = await Costing.findOneAndUpdate(
            { rfqItem: rfqItemId, isDeleted: false },
            { isDeleted: true },
            { new: true }
        );

        if (!costing) {
            throw new ApiError(404, "Costing not found for this RFQ item");
        }

        res.status(200).json(
            new ApiResponse(200, costing, "Costing deleted successfully")
        );
    }
);
