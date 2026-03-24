import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Costing } from "../models/costing.model";
import { RFQItems } from "../models/rfqItems.model";
import { RFQ } from "../models/rfq.models";
import { CommercialSpecs } from "../models/item.commercial.model";

// Round to nearest multiple of 5
const roundTo5 = (n: number): number => Math.round(n / 5) * 5;

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

        const rfq = await RFQ.findOne({ items: rfqItemId, isDeleted: false });
        if (!rfq) {
            throw new ApiError(404, "RFQ not found for this item");
        }

        const {
            parts = [],
            packingCost = 0,
            shippingCost = 0,
            otherCosts = 0,
        } = req.body;

        if (!Array.isArray(parts) || parts.length === 0) {
            throw new ApiError(400, "At least one part is required");
        }

        // Process each part
        const processedParts = parts.map((part: any) => {
            const supplyType = part.supplyType ?? "MANUAL";
            const partQuantity = part.quantity ?? 1;
            const profitMargin = part.profitMargin ?? 0;

            if (supplyType === "COMPLETE_SUPPLY") {
                // Complete supply: costPrice = rate * quantity
                const rate = part.completeSupplyRate ?? 0;
                const costPrice = roundTo5(rate * partQuantity);
                const profitAmount = (costPrice * profitMargin) / 100;
                const partTotal = roundTo5(costPrice + profitAmount);

                return {
                    partName: part.partName ?? "Part",
                    quantity: partQuantity,
                    supplyType,
                    diameter: 0,
                    length: 0,
                    density: 0,
                    weight: 0,
                    materialRate: 0,
                    rawMaterialCost: 0,
                    labourEntries: [],
                    totalLabourCost: 0,
                    completeSupplyRate: rate,
                    completeSupplyParty: part.completeSupplyParty
                        ? new mongoose.Types.ObjectId(
                              part.completeSupplyParty as string
                          )
                        : undefined,
                    completeSupplyDate: part.completeSupplyDate
                        ? new Date(part.completeSupplyDate)
                        : undefined,
                    costPrice,
                    profitMargin,
                    profitAmount,
                    partTotal,
                };
            }

            // MANUAL costing
            const diameter = part.diameter ?? 0;
            const length = part.length ?? 0;
            const density = part.density ?? 7.85;
            const materialRate = part.materialRate ?? 0;

            // Weight calculation (cylinder volume * density)
            const weight =
                (Math.PI * Math.pow(diameter / 2, 2) * length * density) / 1000000;

            // Raw material cost for this part (rate * weight * quantity)
            const rawMaterialCost = roundTo5(weight * materialRate * partQuantity);

            // Labour costs for this part
            const processedLabourEntries = (part.labourEntries ?? []).map(
                (entry: any) => ({
                    ...entry,
                    labourProcessType: entry.labourProcessType,
                    party: entry.party || undefined,
                    cost:
                        entry.rateType === "PER_KG"
                            ? entry.rate * weight
                            : entry.rate,
                })
            );
            const totalLabourCost = processedLabourEntries.reduce(
                (sum: number, e: any) => sum + ((e.cost as number) ?? 0),
                0
            );
            // Labour cost scaled by part quantity
            const totalLabourCostForPart = roundTo5(totalLabourCost * partQuantity);

            // Part-level pricing
            const costPrice = roundTo5(rawMaterialCost + totalLabourCostForPart);
            const profitAmount = (costPrice * profitMargin) / 100;
            const partTotal = roundTo5(costPrice + profitAmount);

            return {
                partName: part.partName ?? "Part",
                quantity: partQuantity,
                supplyType,
                diameter,
                length,
                density,
                weight,
                materialRate,
                rawMaterialParty: part.rawMaterialParty
                    ? new mongoose.Types.ObjectId(part.rawMaterialParty as string)
                    : undefined,
                rawMaterialCost,
                labourEntries: processedLabourEntries,
                totalLabourCost: totalLabourCostForPart,
                completeSupplyRate: 0,
                costPrice,
                profitMargin,
                profitAmount,
                partTotal,
            };
        });

        // Aggregate totals
        const totalPartsCost = processedParts.reduce(
            (sum: number, p: any) => sum + p.partTotal,
            0
        );
        const sellingPrice = roundTo5(
            totalPartsCost + packingCost + shippingCost + otherCosts
        );
        const totalCost = roundTo5(sellingPrice * (rfqItem.quantity ?? 1));

        const costingData = {
            rfqItem: new mongoose.Types.ObjectId(rfqItemId),
            rfq: rfq._id,
            parts: processedParts,
            totalPartsCost,
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

        // Sync to CommercialSpecs
        if (rfqItem.commercialSpecs) {
            const totalRawMaterialCost = processedParts.reduce(
                (sum: number, p: any) =>
                    sum +
                    (p.supplyType === "COMPLETE_SUPPLY"
                        ? p.completeSupplyRate * p.quantity
                        : p.rawMaterialCost),
                0
            );
            const totalLabourCost = processedParts.reduce(
                (sum: number, p: any) => sum + (p.totalLabourCost ?? 0),
                0
            );
            const totalProfitAmount = processedParts.reduce(
                (sum: number, p: any) => sum + (p.profitAmount ?? 0),
                0
            );
            await CommercialSpecs.findByIdAndUpdate(rfqItem.commercialSpecs, {
                $set: {
                    rawMaterialCost: totalRawMaterialCost,
                    laborCost: totalLabourCost,
                    profitMargin: totalProfitAmount,
                    packingCost,
                    shippingCost,
                    otherCosts,
                    sellingPrice,
                    totalCost,
                },
            });
        }

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
            .populate("parts.rawMaterialParty", "acName")
            .populate("parts.completeSupplyParty", "acName")
            .populate("parts.labourEntries.labourProcessType", "name")
            .populate("parts.labourEntries.party", "acName");

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
            .populate("parts.rawMaterialParty", "acName")
            .populate("parts.completeSupplyParty", "acName")
            .populate("parts.labourEntries.labourProcessType", "name")
            .populate("parts.labourEntries.party", "acName");

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
