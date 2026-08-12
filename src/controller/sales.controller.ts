import { Request, Response, NextFunction } from "express";
import fs from "fs";
import mongoose from "mongoose";
import { parse } from "csv-parse/sync";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Sales } from "../models/sales.model";
import { PORegister } from "../models/poRegister.model";
import { Item } from "../models/item.model";
import { mapRowToSales, ParsedSalesRow, RawSalesRow } from "../services/sales/salesSheetMapper";

const BULK_CHUNK_SIZE = 100;

export const importSales = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    if (!req.file) {
        throw new ApiError(400, "No file uploaded");
    }

    const filePath = req.file.path;

    try {
        const raw = fs.readFileSync(filePath, "utf-8").replace(/^﻿/, "");
        const rows: RawSalesRow[] = parse(raw, {
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
        });

        const parsedRecords: ParsedSalesRow[] = [];
        const rowErrors: string[] = [];
        const rowWarnings: string[] = [];

        rows.forEach((row, idx) => {
            const rowNumber = idx + 2; // +1 for 1-index, +1 for header row
            const result = mapRowToSales(row, rowNumber);
            if ("error" in result) {
                rowErrors.push(result.error);
                return;
            }
            parsedRecords.push(result.record);
            rowWarnings.push(...result.warnings);
        });

        // Resolve PORegister / Item references in two batched lookups (avoid N+1).
        const uniquePoNumbers = [
            ...new Set(parsedRecords.map(r => r.poNumber).filter((v): v is string => !!v)),
        ];
        const uniqueItemCodes = [...new Set(parsedRecords.map(r => r.itemCode))];

        const [poRegisters, items] = await Promise.all([
            uniquePoNumbers.length
                ? PORegister.find({ poNumber: { $in: uniquePoNumbers }, isDeleted: false })
                      .select("_id poNumber")
                      .lean()
                : Promise.resolve([]),
            uniqueItemCodes.length
                ? Item.find({ itemCode: { $in: uniqueItemCodes }, isDeleted: false })
                      .select("_id itemCode")
                      .lean()
                : Promise.resolve([]),
        ]);

        const poRegisterMap = new Map(poRegisters.map((p: { poNumber: string; _id: mongoose.Types.ObjectId }) => [p.poNumber, p._id]));
        const itemMap = new Map(items.map((i: { itemCode: string; _id: mongoose.Types.ObjectId }) => [i.itemCode, i._id]));

        const unmatchedPoNumbers = uniquePoNumbers.filter(po => !poRegisterMap.has(po));

        const bulkOps = parsedRecords.map(record => ({
            updateOne: {
                filter: { invoiceNumber: record.invoiceNumber, serialNumber: record.serialNumber },
                update: {
                    $set: {
                        ...record,
                        poRegister: record.poNumber ? poRegisterMap.get(record.poNumber) : undefined,
                        item: itemMap.get(record.itemCode),
                        status: "DISPATCHED",
                        sourceFileName: req.file!.originalname,
                        isDeleted: false,
                    },
                },
                upsert: true,
            },
        }));

        let upsertedCount = 0;
        let modifiedCount = 0;
        for (let i = 0; i < bulkOps.length; i += BULK_CHUNK_SIZE) {
            const chunk = bulkOps.slice(i, i + BULK_CHUNK_SIZE);
            if (chunk.length === 0) continue;
            const result = await Sales.bulkWrite(chunk);
            upsertedCount += result.upsertedCount;
            modifiedCount += result.modifiedCount;
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    totalRows: rows.length,
                    imported: upsertedCount,
                    updated: modifiedCount,
                    skipped: rowErrors.length,
                    rowErrors,
                    rowWarnings,
                    unmatchedPoNumbers,
                },
                "Sales data imported successfully"
            )
        );
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

export const getAllSales = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const search = (req.query.search as string) || "";
    const sortBy = (req.query.sortBy as string) || "dispatchDate";
    const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;
    const companyName = (req.query.companyName as string) || "";

    const filter: Record<string, unknown> = { isDeleted: false };

    if (companyName) {
        filter.companyName = companyName;
    }

    if (search) {
        filter.$or = [
            { invoiceNumber: { $regex: search, $options: "i" } },
            { poNumber: { $regex: search, $options: "i" } },
            { poReference: { $regex: search, $options: "i" } },
            { companyName: { $regex: search, $options: "i" } },
            { itemCode: { $regex: search, $options: "i" } },
            { itemName: { $regex: search, $options: "i" } },
            { ewayBillNumber: { $regex: search, $options: "i" } },
            { consignmentNumber: { $regex: search, $options: "i" } },
        ];
    }

    const allowedSortFields = [
        "dispatchDate",
        "invoiceDate",
        "invoiceNumber",
        "companyName",
        "netAmount",
        "quantity",
    ];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "dispatchDate";

    const total = await Sales.countDocuments(filter);
    const totalPages = Math.ceil(total / size);
    const data = await Sales.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * size)
        .limit(size)
        .lean();

    res.status(200).json(
        new ApiResponse(200, { data, total, totalPages, page, size }, "Sales fetched successfully")
    );
});

export const getSalesById = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id!)) {
        throw new ApiError(400, "Invalid Sales ID");
    }

    const sale = await Sales.findOne({ _id: id, isDeleted: false });
    if (!sale) {
        throw new ApiError(404, "Sales record not found");
    }

    res.status(200).json(new ApiResponse(200, sale, "Sales record fetched successfully"));
});

export const deleteSales = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id!)) {
        throw new ApiError(400, "Invalid Sales ID");
    }

    const sale = await Sales.findByIdAndUpdate(
        id,
        { isDeleted: true, deletedAt: new Date() },
        { new: true }
    );
    if (!sale) {
        throw new ApiError(404, "Sales record not found");
    }

    res.status(200).json(new ApiResponse(200, sale, "Sales record deleted successfully"));
});

export const getSalesStats = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    const [overviewResult, trend, topCustomers, topItems] = await Promise.all([
        Sales.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: null,
                    totalValue: { $sum: "$netAmount" },
                    totalQuantity: { $sum: "$quantity" },
                    invoiceNumbers: { $addToSet: "$invoiceNumber" },
                    companies: { $addToSet: "$companyName" },
                },
            },
            {
                $project: {
                    _id: 0,
                    totalValue: 1,
                    totalQuantity: 1,
                    totalInvoices: { $size: "$invoiceNumbers" },
                    totalCompanies: { $size: "$companies" },
                },
            },
        ]),
        Sales.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: { year: { $year: "$dispatchDate" }, month: { $month: "$dispatchDate" } },
                    totalValue: { $sum: "$netAmount" },
                    totalQuantity: { $sum: "$quantity" },
                    invoiceNumbers: { $addToSet: "$invoiceNumber" },
                },
            },
            {
                $project: {
                    year: "$_id.year",
                    month: "$_id.month",
                    totalValue: 1,
                    totalQuantity: 1,
                    invoiceCount: { $size: "$invoiceNumbers" },
                    _id: 0,
                },
            },
            { $sort: { year: 1, month: 1 } },
        ]),
        Sales.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: "$companyName",
                    totalValue: { $sum: "$netAmount" },
                    totalQuantity: { $sum: "$quantity" },
                },
            },
            { $sort: { totalValue: -1 } },
            { $limit: 10 },
            { $project: { companyName: "$_id", totalValue: 1, totalQuantity: 1, _id: 0 } },
        ]),
        Sales.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: { itemCode: "$itemCode", itemName: "$itemName" },
                    totalValue: { $sum: "$netAmount" },
                    totalQuantity: { $sum: "$quantity" },
                },
            },
            { $sort: { totalValue: -1 } },
            { $limit: 10 },
            {
                $project: {
                    itemCode: "$_id.itemCode",
                    itemName: "$_id.itemName",
                    totalValue: 1,
                    totalQuantity: 1,
                    _id: 0,
                },
            },
        ]),
    ]);

    const overview = overviewResult[0] ?? {
        totalValue: 0,
        totalQuantity: 0,
        totalInvoices: 0,
        totalCompanies: 0,
    };

    res.status(200).json(
        new ApiResponse(200, { overview, trend, topCustomers, topItems }, "Sales stats fetched successfully")
    );
});

/**
 * PO fulfillment view: cross-reference Sales (dispatched quantities) against
 * PORegister (ordered quantities) per PO + item code.
 */
export const getPoFulfillment = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

        const dispatchedAgg = await Sales.aggregate([
            { $match: { isDeleted: false, poNumber: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: { poNumber: "$poNumber", itemCode: "$itemCode" },
                    dispatchedQty: { $sum: "$quantity" },
                },
            },
        ]);

        const dispatchedMap = new Map<string, number>();
        const poNumbers = new Set<string>();
        for (const d of dispatchedAgg) {
            const key = `${d._id.poNumber}::${d._id.itemCode}`;
            dispatchedMap.set(key, d.dispatchedQty);
            poNumbers.add(d._id.poNumber);
        }

        if (poNumbers.size === 0) {
            res.status(200).json(
                new ApiResponse(
                    200,
                    { summary: { fullyDispatched: 0, partiallyDispatched: 0, notDispatched: 0 }, pos: [] },
                    "PO fulfillment fetched successfully"
                )
            );
            return;
        }

        const poRegisters = await PORegister.find({
            poNumber: { $in: [...poNumbers] },
            isDeleted: false,
        }).lean();

        const summary = { fullyDispatched: 0, partiallyDispatched: 0, notDispatched: 0 };

        const pos = poRegisters.map(po => {
            const items = po.items.map(item => {
                const dispatchedQty = dispatchedMap.get(`${po.poNumber}::${item.itemCode}`) ?? 0;
                const orderedQty = item.quantity;
                const pendingQty = Math.max(0, orderedQty - dispatchedQty);
                const fulfillmentPct = orderedQty > 0 ? Math.min(100, (dispatchedQty / orderedQty) * 100) : 0;
                return {
                    itemCode: item.itemCode,
                    itemDescription: item.itemDescription,
                    orderedQty,
                    dispatchedQty,
                    pendingQty,
                    fulfillmentPct,
                };
            });

            const totalOrdered = items.reduce((s, i) => s + i.orderedQty, 0);
            const totalDispatched = items.reduce((s, i) => s + i.dispatchedQty, 0);
            const status =
                totalDispatched === 0
                    ? "NOT_DISPATCHED"
                    : totalDispatched >= totalOrdered
                      ? "FULLY_DISPATCHED"
                      : "PARTIALLY_DISPATCHED";

            if (status === "FULLY_DISPATCHED") summary.fullyDispatched++;
            else if (status === "PARTIALLY_DISPATCHED") summary.partiallyDispatched++;
            else summary.notDispatched++;

            return {
                poNumber: po.poNumber,
                jobNumber: po.jobNumber,
                companyName: po.companyName,
                poDate: po.poDate,
                status,
                pendingQty: totalOrdered - totalDispatched,
                items,
            };
        });

        pos.sort((a, b) => b.pendingQty - a.pendingQty);

        res.status(200).json(
            new ApiResponse(200, { summary, pos: pos.slice(0, limit) }, "PO fulfillment fetched successfully")
        );
    }
);
