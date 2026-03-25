import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Costing } from "../models/costing.model";

// Get material rate history for a specific party
export const getMaterialRateHistory = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { partyId } = req.params;

        if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
            throw new ApiError(400, "Invalid party ID");
        }

        const pipeline = [
            { $match: { isDeleted: false } },
            { $unwind: "$parts" },
            {
                $match: {
                    "parts.supplyType": "MANUAL",
                    "parts.rawMaterialParty": new mongoose.Types.ObjectId(partyId),
                    "parts.materialRate": { $gt: 0 },
                },
            },
            {
                $lookup: {
                    from: "rfqitems",
                    localField: "rfqItem",
                    foreignField: "_id",
                    as: "rfqItemDoc",
                },
            },
            { $unwind: { path: "$rfqItemDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "items",
                    localField: "rfqItemDoc.item",
                    foreignField: "_id",
                    as: "itemDoc",
                },
            },
            { $unwind: { path: "$itemDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "rfqs",
                    localField: "rfq",
                    foreignField: "_id",
                    as: "rfqDoc",
                },
            },
            { $unwind: { path: "$rfqDoc", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    partName: "$parts.partName",
                    materialRate: "$parts.materialRate",
                    weight: "$parts.weight",
                    rawMaterialCost: "$parts.rawMaterialCost",
                    itemCode: "$itemDoc.itemCode",
                    itemName: "$itemDoc.itemName",
                    prNumber: "$rfqDoc.prNumber",
                    date: "$createdAt",
                },
            },
            { $sort: { date: -1 as const } },
            { $limit: 50 },
        ];

        const history = await Costing.aggregate(pipeline);

        res.status(200).json(new ApiResponse(200, history, "Material rate history fetched"));
    }
);

// Get labour rate history for a specific party
export const getLabourRateHistory = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { partyId } = req.params;

        if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
            throw new ApiError(400, "Invalid party ID");
        }

        const pipeline = [
            { $match: { isDeleted: false } },
            { $unwind: "$parts" },
            { $unwind: "$parts.labourEntries" },
            {
                $match: {
                    "parts.labourEntries.party": new mongoose.Types.ObjectId(partyId),
                    "parts.labourEntries.rate": { $gt: 0 },
                },
            },
            {
                $lookup: {
                    from: "labourprocesstypes",
                    localField: "parts.labourEntries.labourProcessType",
                    foreignField: "_id",
                    as: "processDoc",
                },
            },
            { $unwind: { path: "$processDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "rfqitems",
                    localField: "rfqItem",
                    foreignField: "_id",
                    as: "rfqItemDoc",
                },
            },
            { $unwind: { path: "$rfqItemDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "items",
                    localField: "rfqItemDoc.item",
                    foreignField: "_id",
                    as: "itemDoc",
                },
            },
            { $unwind: { path: "$itemDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "rfqs",
                    localField: "rfq",
                    foreignField: "_id",
                    as: "rfqDoc",
                },
            },
            { $unwind: { path: "$rfqDoc", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    partName: "$parts.partName",
                    processName: "$processDoc.name",
                    rate: "$parts.labourEntries.rate",
                    rateType: "$parts.labourEntries.rateType",
                    cost: "$parts.labourEntries.cost",
                    itemCode: "$itemDoc.itemCode",
                    itemName: "$itemDoc.itemName",
                    prNumber: "$rfqDoc.prNumber",
                    date: "$createdAt",
                },
            },
            { $sort: { date: -1 as const } },
            { $limit: 50 },
        ];

        const history = await Costing.aggregate(pipeline);

        res.status(200).json(new ApiResponse(200, history, "Labour rate history fetched"));
    }
);

// Get complete supply rate history for a specific party
export const getSupplyRateHistory = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { partyId } = req.params;

        if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
            throw new ApiError(400, "Invalid party ID");
        }

        const pipeline = [
            { $match: { isDeleted: false } },
            { $unwind: "$parts" },
            {
                $match: {
                    "parts.supplyType": "COMPLETE_SUPPLY",
                    "parts.completeSupplyParty": new mongoose.Types.ObjectId(partyId),
                    "parts.completeSupplyRate": { $gt: 0 },
                },
            },
            {
                $lookup: {
                    from: "rfqitems",
                    localField: "rfqItem",
                    foreignField: "_id",
                    as: "rfqItemDoc",
                },
            },
            { $unwind: { path: "$rfqItemDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "items",
                    localField: "rfqItemDoc.item",
                    foreignField: "_id",
                    as: "itemDoc",
                },
            },
            { $unwind: { path: "$itemDoc", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: "rfqs",
                    localField: "rfq",
                    foreignField: "_id",
                    as: "rfqDoc",
                },
            },
            { $unwind: { path: "$rfqDoc", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    partName: "$parts.partName",
                    rate: "$parts.completeSupplyRate",
                    quantity: "$parts.quantity",
                    costPrice: "$parts.costPrice",
                    itemCode: "$itemDoc.itemCode",
                    itemName: "$itemDoc.itemName",
                    prNumber: "$rfqDoc.prNumber",
                    date: "$createdAt",
                },
            },
            { $sort: { date: -1 as const } },
            { $limit: 50 },
        ];

        const history = await Costing.aggregate(pipeline);

        res.status(200).json(new ApiResponse(200, history, "Supply rate history fetched"));
    }
);

// Vendor comparison: compare rates across parties for same material/process
export const getVendorComparison = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { type } = req.query; // "material" | "labour" | "supply"

        if (!type || !["material", "labour", "supply"].includes(type as string)) {
            throw new ApiError(400, "Type must be 'material', 'labour', or 'supply'");
        }

        if (type === "material") {
            const pipeline = [
                { $match: { isDeleted: false } },
                { $unwind: "$parts" },
                {
                    $match: {
                        "parts.supplyType": "MANUAL",
                        "parts.rawMaterialParty": { $exists: true, $ne: null },
                        "parts.materialRate": { $gt: 0 },
                    },
                },
                {
                    $group: {
                        _id: "$parts.rawMaterialParty",
                        avgRate: { $avg: "$parts.materialRate" },
                        minRate: { $min: "$parts.materialRate" },
                        maxRate: { $max: "$parts.materialRate" },
                        latestRate: { $last: "$parts.materialRate" },
                        totalOrders: { $sum: 1 },
                        lastUsed: { $max: "$createdAt" },
                    },
                },
                {
                    $lookup: {
                        from: "parties",
                        localField: "_id",
                        foreignField: "_id",
                        as: "party",
                    },
                },
                { $unwind: "$party" },
                {
                    $project: {
                        partyId: "$_id",
                        partyName: "$party.acName",
                        partyType: "$party.partyType",
                        avgRate: { $round: ["$avgRate", 2] },
                        minRate: 1,
                        maxRate: 1,
                        latestRate: 1,
                        totalOrders: 1,
                        lastUsed: 1,
                    },
                },
                { $sort: { avgRate: 1 as const } },
            ];

            const comparison = await Costing.aggregate(pipeline);
            res.status(200).json(
                new ApiResponse(200, comparison, "Material vendor comparison fetched")
            );
            return;
        }

        if (type === "labour") {
            const pipeline = [
                { $match: { isDeleted: false } },
                { $unwind: "$parts" },
                { $unwind: "$parts.labourEntries" },
                {
                    $match: {
                        "parts.labourEntries.party": { $exists: true, $ne: null },
                        "parts.labourEntries.rate": { $gt: 0 },
                    },
                },
                {
                    $lookup: {
                        from: "labourprocesstypes",
                        localField: "parts.labourEntries.labourProcessType",
                        foreignField: "_id",
                        as: "processDoc",
                    },
                },
                { $unwind: { path: "$processDoc", preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: {
                            party: "$parts.labourEntries.party",
                            process: "$parts.labourEntries.labourProcessType",
                        },
                        processName: { $first: "$processDoc.name" },
                        avgRate: { $avg: "$parts.labourEntries.rate" },
                        minRate: { $min: "$parts.labourEntries.rate" },
                        maxRate: { $max: "$parts.labourEntries.rate" },
                        latestRate: { $last: "$parts.labourEntries.rate" },
                        rateType: { $first: "$parts.labourEntries.rateType" },
                        totalOrders: { $sum: 1 },
                        lastUsed: { $max: "$createdAt" },
                    },
                },
                {
                    $lookup: {
                        from: "parties",
                        localField: "_id.party",
                        foreignField: "_id",
                        as: "party",
                    },
                },
                { $unwind: "$party" },
                {
                    $project: {
                        partyId: "$_id.party",
                        partyName: "$party.acName",
                        processId: "$_id.process",
                        processName: 1,
                        avgRate: { $round: ["$avgRate", 2] },
                        minRate: 1,
                        maxRate: 1,
                        latestRate: 1,
                        rateType: 1,
                        totalOrders: 1,
                        lastUsed: 1,
                    },
                },
                { $sort: { processName: 1 as const, avgRate: 1 as const } },
            ];

            const comparison = await Costing.aggregate(pipeline);
            res.status(200).json(
                new ApiResponse(200, comparison, "Labour vendor comparison fetched")
            );
            return;
        }

        // supply
        const pipeline = [
            { $match: { isDeleted: false } },
            { $unwind: "$parts" },
            {
                $match: {
                    "parts.supplyType": "COMPLETE_SUPPLY",
                    "parts.completeSupplyParty": { $exists: true, $ne: null },
                    "parts.completeSupplyRate": { $gt: 0 },
                },
            },
            {
                $group: {
                    _id: "$parts.completeSupplyParty",
                    avgRate: { $avg: "$parts.completeSupplyRate" },
                    minRate: { $min: "$parts.completeSupplyRate" },
                    maxRate: { $max: "$parts.completeSupplyRate" },
                    latestRate: { $last: "$parts.completeSupplyRate" },
                    totalOrders: { $sum: 1 },
                    lastUsed: { $max: "$createdAt" },
                },
            },
            {
                $lookup: {
                    from: "parties",
                    localField: "_id",
                    foreignField: "_id",
                    as: "party",
                },
            },
            { $unwind: "$party" },
            {
                $project: {
                    partyId: "$_id",
                    partyName: "$party.acName",
                    avgRate: { $round: ["$avgRate", 2] },
                    minRate: 1,
                    maxRate: 1,
                    latestRate: 1,
                    totalOrders: 1,
                    lastUsed: 1,
                },
            },
            { $sort: { avgRate: 1 as const } },
        ];

        const comparison = await Costing.aggregate(pipeline);
        res.status(200).json(new ApiResponse(200, comparison, "Supply vendor comparison fetched"));
    }
);
