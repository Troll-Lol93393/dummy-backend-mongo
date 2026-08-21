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
                ? PORegister.find({ corePoNumber: { $in: uniquePoNumbers }, isDeleted: false })
                      .select("_id corePoNumber")
                      .lean()
                : Promise.resolve([]),
            uniqueItemCodes.length
                ? Item.find({ itemCode: { $in: uniqueItemCodes }, isDeleted: false })
                      .select("_id itemCode")
                      .lean()
                : Promise.resolve([]),
        ]);

        const poRegisterMap = new Map(poRegisters.map((p: { corePoNumber: string; _id: mongoose.Types.ObjectId }) => [p.corePoNumber, p._id]));
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
    const financialYear = (req.query.financialYear as string) || "";

    const filter: Record<string, unknown> = { isDeleted: false };

    if (companyName) {
        filter.companyName = companyName;
    }
    if (financialYear) {
        filter.financialYear = financialYear;
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

const EDITABLE_TRANSPORT_FIELDS = ["transporterName", "transporterGstin", "consignmentNumber", "ewayBillNumber", "barcode"] as const;

/**
 * Sales line items are otherwise read-only (they reflect what the invoice said),
 * but transporter/consignment/e-way-bill/barcode info is frequently missing from
 * the source import and needs to be backfillable by hand — this is the only
 * update path, deliberately scoped to those five fields.
 */
export const updateSalesTransportDetails = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id!)) {
            throw new ApiError(400, "Invalid Sales ID");
        }

        const update: Record<string, string> = {};
        for (const field of EDITABLE_TRANSPORT_FIELDS) {
            const value = req.body[field];
            if (value !== undefined) {
                update[field] = typeof value === "string" ? value.trim() : value;
            }
        }

        if (Object.keys(update).length === 0) {
            throw new ApiError(400, "No editable fields provided");
        }

        const sale = await Sales.findOneAndUpdate({ _id: id, isDeleted: false }, { $set: update }, { new: true });
        if (!sale) {
            throw new ApiError(404, "Sales record not found");
        }

        res.status(200).json(new ApiResponse(200, sale, "Transport details updated successfully"));
    }
);

const TRANSPORT_TEMPLATE_HEADERS = ["Invoice Number", "Transporter Name", "Transporter GSTIN", "Consignment Number"];

const TRANSPORT_TEMPLATE_EXAMPLE_ROW = ["SE/2526/000066", "VRL Logistics Ltd.", "27ABCDE1234F1Z5", "CN-000123"];

function toCsvLine(cells: string[]): string {
    return cells
        .map(cell => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(",");
}

/**
 * Keyed by Invoice Number alone — transporter/consignment/e-way-bill info is
 * the same for an entire shipment, so one row updates every line item on
 * that invoice. No item-level targeting: a single invoice always ships as
 * one consignment in this workflow.
 */
export const downloadTransportDetailsTemplate = asyncHandler(
    async (_req: Request, res: Response, _next: NextFunction) => {
        const csv = [toCsvLine(TRANSPORT_TEMPLATE_HEADERS), toCsvLine(TRANSPORT_TEMPLATE_EXAMPLE_ROW)].join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="transport-details-template.csv"');
        res.status(200).send(csv);
    }
);

export const bulkImportTransportDetails = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) {
            throw new ApiError(400, "No file uploaded");
        }

        const filePath = req.file.path;

        try {
            const raw = fs.readFileSync(filePath, "utf-8").replace(/^﻿/, "");
            const rows: Record<string, string>[] = parse(raw, {
                columns: true,
                skip_empty_lines: true,
                relax_column_count: true,
                trim: true,
            });

            type ValidRow = {
                rowNumber: number;
                invoiceNumber: string;
                update: Record<string, string>;
            };

            const validRows: ValidRow[] = [];
            const rowErrors: string[] = [];

            rows.forEach((row, idx) => {
                const rowNumber = idx + 2;
                const invoiceNumber = row["Invoice Number"]?.trim();

                if (!invoiceNumber) {
                    rowErrors.push(`Row ${rowNumber}: Invoice Number is required`);
                    return;
                }

                const update: Record<string, string> = {};
                if (row["Transporter Name"]?.trim()) update.transporterName = row["Transporter Name"].trim();
                if (row["Transporter GSTIN"]?.trim()) update.transporterGstin = row["Transporter GSTIN"].trim();
                if (row["Consignment Number"]?.trim()) update.consignmentNumber = row["Consignment Number"].trim();

                if (Object.keys(update).length === 0) {
                    rowErrors.push(`Row ${rowNumber}: no transporter fields provided, skipped`);
                    return;
                }

                validRows.push({ rowNumber, invoiceNumber, update });
            });

            const uniqueInvoiceNumbers = [...new Set(validRows.map(r => r.invoiceNumber))];
            const existing = uniqueInvoiceNumbers.length
                ? await Sales.find({ invoiceNumber: { $in: uniqueInvoiceNumbers }, isDeleted: false })
                      .select("invoiceNumber")
                      .lean()
                : [];
            const existingInvoiceNumbers = new Set(existing.map(e => e.invoiceNumber));

            const bulkOps: mongoose.AnyBulkWriteOperation[] = [];
            let notFoundCount = 0;

            for (const row of validRows) {
                if (!existingInvoiceNumbers.has(row.invoiceNumber)) {
                    rowErrors.push(`Row ${row.rowNumber}: no sales record found for invoice ${row.invoiceNumber}`);
                    notFoundCount += 1;
                    continue;
                }

                const filter: Record<string, unknown> = {
                    invoiceNumber: row.invoiceNumber,
                    isDeleted: false,
                };

                bulkOps.push({ updateMany: { filter, update: { $set: row.update } } });
            }

            let matchedCount = 0;
            let modifiedCount = 0;
            for (let i = 0; i < bulkOps.length; i += BULK_CHUNK_SIZE) {
                const chunk = bulkOps.slice(i, i + BULK_CHUNK_SIZE);
                if (chunk.length === 0) continue;
                const result = await Sales.bulkWrite(chunk);
                matchedCount += result.matchedCount;
                modifiedCount += result.modifiedCount;
            }

            res.status(200).json(
                new ApiResponse(
                    200,
                    {
                        totalRows: rows.length,
                        matched: matchedCount,
                        updated: modifiedCount,
                        notFound: notFoundCount,
                        skipped: rowErrors.length,
                        rowErrors,
                    },
                    "Transport details bulk import processed"
                )
            );
        } finally {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    }
);

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

export const getSalesStats = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const financialYear = (req.query.financialYear as string) || "";
    const match: Record<string, unknown> = { isDeleted: false };
    if (financialYear) {
        match.financialYear = financialYear;
    }

    const [overviewResult, trend, topCustomers, topItems] = await Promise.all([
        Sales.aggregate([
            { $match: match },
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
            { $match: match },
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
            { $match: match },
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
            { $match: match },
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
        const financialYear = (req.query.financialYear as string) || "";
        const dispatchMatch: Record<string, unknown> = { isDeleted: false, poNumber: { $exists: true, $ne: null } };
        if (financialYear) dispatchMatch.financialYear = financialYear;

        const dispatchedAgg = await Sales.aggregate([
            { $match: dispatchMatch },
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
            corePoNumber: { $in: [...poNumbers] },
            isDeleted: false,
        }).lean();

        const summary = { fullyDispatched: 0, partiallyDispatched: 0, notDispatched: 0 };

        const pos = poRegisters.map(po => {
            const items = po.items.map(item => {
                const dispatchedQty = dispatchedMap.get(`${po.corePoNumber}::${item.itemCode}`) ?? 0;
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

export const getFinancialYears = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    const years = (await Sales.distinct("financialYear", { isDeleted: false })).filter(Boolean) as string[];
    years.sort((a, b) => b.localeCompare(a));
    res.status(200).json(new ApiResponse(200, years, "Financial years fetched successfully"));
});

/**
 * Invoice-level list: one row per invoice, aggregated across its line items.
 */
export const getInvoices = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 10;
    const search = (req.query.search as string) || "";
    const financialYear = (req.query.financialYear as string) || "";
    const sortBy = (req.query.sortBy as string) || "dispatchDate";
    const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

    const match: Record<string, unknown> = { isDeleted: false };
    if (financialYear) match.financialYear = financialYear;
    if (search) {
        match.$or = [
            { invoiceNumber: { $regex: search, $options: "i" } },
            { poNumber: { $regex: search, $options: "i" } },
            { companyName: { $regex: search, $options: "i" } },
        ];
    }

    const allowedSortFields = ["dispatchDate", "invoiceNumber", "companyName", "totalNetAmount", "totalQuantity"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "dispatchDate";

    const results = await Sales.aggregate([
        { $match: match },
        {
            $group: {
                _id: "$invoiceNumber",
                dispatchDate: { $first: "$dispatchDate" },
                financialYear: { $first: "$financialYear" },
                poNumber: { $first: "$poNumber" },
                poReference: { $first: "$poReference" },
                companyName: { $first: "$companyName" },
                transporterName: { $first: "$transporterName" },
                status: { $first: "$status" },
                itemCount: { $sum: 1 },
                totalQuantity: { $sum: "$quantity" },
                totalNetAmount: { $sum: "$netAmount" },
            },
        },
        {
            $project: {
                _id: 0,
                invoiceNumber: "$_id",
                dispatchDate: 1,
                financialYear: 1,
                poNumber: 1,
                poReference: 1,
                companyName: 1,
                transporterName: 1,
                status: 1,
                itemCount: 1,
                totalQuantity: 1,
                totalNetAmount: 1,
            },
        },
        { $sort: { [sortField]: sortOrder } },
        {
            $facet: {
                data: [{ $skip: (page - 1) * size }, { $limit: size }],
                totalCount: [{ $count: "count" }],
            },
        },
    ]);

    const data = results[0]?.data ?? [];
    const total = results[0]?.totalCount?.[0]?.count ?? 0;
    const totalPages = Math.ceil(total / size);

    res.status(200).json(
        new ApiResponse(200, { data, total, totalPages, page, size }, "Invoices fetched successfully")
    );
});

/**
 * Full line-item detail for a single invoice, for the table's "View" action.
 */
export const getInvoiceDetail = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { invoiceNumber } = req.params;
    const items = await Sales.find({ invoiceNumber, isDeleted: false })
        .sort({ serialNumber: 1 })
        .lean();

    if (items.length === 0) {
        throw new ApiError(404, "Invoice not found");
    }

    const first = items[0]!;
    const header = {
        invoiceNumber: first.invoiceNumber,
        dispatchDate: first.dispatchDate,
        financialYear: first.financialYear,
        poNumber: first.poNumber,
        poReference: first.poReference,
        companyName: first.companyName,
        gstin: first.gstin,
        transporterName: first.transporterName,
        transporterGstin: first.transporterGstin,
        totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
        totalNetAmount: items.reduce((sum, i) => sum + i.netAmount, 0),
    };

    res.status(200).json(new ApiResponse(200, { header, items }, "Invoice detail fetched successfully"));
});

/**
 * Invoice-level barcode status list: one row per distinct invoiceNumber,
 * with the invoice's barcode value (barcode is one-per-invoice, not
 * per-line-item — see setInvoiceBarcode below). Supports search and a
 * "missing only" filter for the barcode backfill workflow.
 */
export const getBarcodeStatus = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const search = (req.query.search as string) || "";
    const missingOnly = req.query.missingOnly === "true";

    const match: Record<string, unknown> = { isDeleted: false };
    if (search) {
        match.$or = [
            { invoiceNumber: { $regex: search, $options: "i" } },
            { companyName: { $regex: search, $options: "i" } },
        ];
    }

    const pipeline: mongoose.PipelineStage[] = [
        { $match: match },
        {
            $group: {
                _id: "$invoiceNumber",
                companyName: { $first: "$companyName" },
                dispatchDate: { $first: "$dispatchDate" },
                invoiceDate: { $first: "$invoiceDate" },
                barcode: { $first: "$barcode" },
            },
        },
        {
            $project: {
                _id: 0,
                invoiceNumber: "$_id",
                companyName: 1,
                dispatchDate: 1,
                invoiceDate: 1,
                barcode: 1,
            },
        },
    ];

    if (missingOnly) {
        pipeline.push({
            $match: {
                $or: [{ barcode: { $exists: false } }, { barcode: null }, { barcode: "" }],
            },
        });
    }

    pipeline.push(
        { $sort: { dispatchDate: -1 } },
        {
            $facet: {
                data: [{ $skip: (page - 1) * size }, { $limit: size }],
                totalCount: [{ $count: "count" }],
            },
        }
    );

    const results = await Sales.aggregate(pipeline);
    const data = results[0]?.data ?? [];
    const total = results[0]?.totalCount?.[0]?.count ?? 0;
    const totalPages = Math.ceil(total / size);

    res.status(200).json(
        new ApiResponse(200, { data, total, totalPages, page, size }, "Barcode status fetched successfully")
    );
});

/**
 * Sets the same barcode across every Sales line-item document sharing the
 * given invoice number — barcode is an invoice-level concept (JSW's VSC
 * barcode format wants one per invoice), whereas the existing
 * updateSalesTransportDetails endpoint edits a single line-item document
 * by _id. This is the invoice-level counterpart.
 */
export const setInvoiceBarcode = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { invoiceNumber } = req.params;
    const barcodeRaw = req.body.barcode;

    if (typeof barcodeRaw !== "string" || barcodeRaw.trim().length === 0) {
        throw new ApiError(400, "Barcode is required and must be a non-empty string");
    }
    const barcode = barcodeRaw.trim();

    const result = await Sales.updateMany({ invoiceNumber, isDeleted: false }, { $set: { barcode } });

    if (result.matchedCount === 0) {
        throw new ApiError(404, "No sales records found for this invoice number");
    }

    res.status(200).json(
        new ApiResponse(
            200,
            { invoiceNumber, barcode, matched: result.matchedCount, modified: result.modifiedCount },
            "Invoice barcode updated successfully"
        )
    );
});

const EDITABLE_INVOICE_TRANSPORT_FIELDS = ["transporterName", "transporterGstin", "consignmentNumber"] as const;

/**
 * Sets transporter/consignment info across every Sales line-item document
 * sharing the given invoice number — same invoice-level pattern as
 * setInvoiceBarcode above, since a single invoice always ships as one
 * consignment in this workflow. E-way bill number is deliberately not
 * editable here: it arrives with the invoice import itself and isn't
 * something this dialog should be backfilling.
 */
export const setInvoiceTransportDetails = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { invoiceNumber } = req.params;

        const update: Record<string, string> = {};
        for (const field of EDITABLE_INVOICE_TRANSPORT_FIELDS) {
            const value = req.body[field];
            if (typeof value === "string" && value.trim().length > 0) {
                update[field] = value.trim();
            }
        }

        if (Object.keys(update).length === 0) {
            throw new ApiError(
                400,
                "At least one of transporterName, transporterGstin, consignmentNumber is required"
            );
        }

        const result = await Sales.updateMany({ invoiceNumber, isDeleted: false }, { $set: update });

        if (result.matchedCount === 0) {
            throw new ApiError(404, "No sales records found for this invoice number");
        }

        res.status(200).json(
            new ApiResponse(
                200,
                { invoiceNumber, ...update, matched: result.matchedCount, modified: result.modifiedCount },
                "Invoice transport details updated successfully"
            )
        );
    }
);

const BARCODE_TEMPLATE_HEADERS = ["Invoice Number", "Barcode"];
const BARCODE_TEMPLATE_EXAMPLE_ROW = ["SE/2526/000066", "12345678901234567"];

export const downloadBarcodeImportTemplate = asyncHandler(
    async (_req: Request, res: Response, _next: NextFunction) => {
        const csv = [toCsvLine(BARCODE_TEMPLATE_HEADERS), toCsvLine(BARCODE_TEMPLATE_EXAMPLE_ROW)].join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="barcode-import-template.csv"');
        res.status(200).send(csv);
    }
);

/**
 * Bulk barcode import: one barcode per invoice number (last row wins if an
 * invoice number appears more than once in the file), applied to every
 * Sales line-item document sharing that invoice number via updateMany.
 */
export const importBarcodes = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    if (!req.file) {
        throw new ApiError(400, "No file uploaded");
    }

    const filePath = req.file.path;

    try {
        const raw = fs.readFileSync(filePath, "utf-8").replace(/^﻿/, "");
        const rows: Record<string, string>[] = parse(raw, {
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
        });

        const rowErrors: string[] = [];
        const invoiceBarcodeMap = new Map<string, string>();

        rows.forEach((row, idx) => {
            const rowNumber = idx + 2;
            const invoiceNumber = row["Invoice Number"]?.trim();
            const barcode = row["Barcode"]?.trim();

            if (!invoiceNumber || !barcode) {
                rowErrors.push(`Row ${rowNumber}: Invoice Number and Barcode are required`);
                return;
            }

            invoiceBarcodeMap.set(invoiceNumber, barcode);
        });

        const uniqueInvoiceNumbers = [...invoiceBarcodeMap.keys()];
        const existing = uniqueInvoiceNumbers.length
            ? await Sales.find({ invoiceNumber: { $in: uniqueInvoiceNumbers }, isDeleted: false })
                  .select("invoiceNumber")
                  .lean()
            : [];
        const existingInvoiceNumbers = new Set(existing.map(e => e.invoiceNumber));

        const notFoundInvoiceNumbers: string[] = [];
        const bulkOps: mongoose.AnyBulkWriteOperation[] = [];

        for (const invoiceNumber of uniqueInvoiceNumbers) {
            if (!existingInvoiceNumbers.has(invoiceNumber)) {
                notFoundInvoiceNumbers.push(invoiceNumber);
                rowErrors.push(`Invoice ${invoiceNumber}: no sales record found, skipped`);
                continue;
            }
            bulkOps.push({
                updateMany: {
                    filter: { invoiceNumber, isDeleted: false },
                    update: { $set: { barcode: invoiceBarcodeMap.get(invoiceNumber) } },
                },
            });
        }

        let matchedCount = 0;
        let modifiedCount = 0;
        for (let i = 0; i < bulkOps.length; i += BULK_CHUNK_SIZE) {
            const chunk = bulkOps.slice(i, i + BULK_CHUNK_SIZE);
            if (chunk.length === 0) continue;
            const result = await Sales.bulkWrite(chunk);
            matchedCount += result.matchedCount;
            modifiedCount += result.modifiedCount;
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    totalRows: rows.length,
                    matched: matchedCount,
                    updated: modifiedCount,
                    notFound: notFoundInvoiceNumbers.length,
                    notFoundInvoiceNumbers,
                    skipped: rowErrors.length,
                    rowErrors,
                },
                "Barcode bulk import processed"
            )
        );
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

type PoRegisterLineItem = { itemCode: string; itemDescription: string; quantity: number };
type PoRegisterLean = {
    poNumber: string;
    corePoNumber: string;
    jobNumber: string;
    companyName: string;
    poDate: Date;
    items: PoRegisterLineItem[];
};

/**
 * PO-level dispatch list: every PO that has at least one dispatch (Sales row)
 * against it, left-joined with PORegister for ordered quantities. POs with no
 * PORegister match still show up (status PO_NOT_FOUND) rather than being
 * silently dropped — the whole point is visibility into what's been dispatched.
 */
export const getPoDispatchList = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const search = ((req.query.search as string) || "").toLowerCase().trim();
    const financialYear = (req.query.financialYear as string) || "";

    const dispatchMatch: Record<string, unknown> = { isDeleted: false, poNumber: { $exists: true, $ne: null } };
    if (financialYear) dispatchMatch.financialYear = financialYear;

    const [dispatchedByItem, poSummaries] = await Promise.all([
        Sales.aggregate([
            { $match: dispatchMatch },
            {
                $group: {
                    _id: { poNumber: "$poNumber", itemCode: "$itemCode" },
                    dispatchedQty: { $sum: "$quantity" },
                },
            },
        ]),
        Sales.aggregate([
            { $match: dispatchMatch },
            {
                $group: {
                    _id: "$poNumber",
                    companyName: { $first: "$companyName" },
                    lastDispatchDate: { $max: "$dispatchDate" },
                    invoiceNumbers: { $addToSet: "$invoiceNumber" },
                },
            },
        ]),
    ]);

    const dispatchedMap = new Map<string, number>();
    for (const d of dispatchedByItem) {
        dispatchedMap.set(`${d._id.poNumber}::${d._id.itemCode}`, d.dispatchedQty);
    }

    const poNumbers = poSummaries.map(p => p._id as string);
    const poRegisters = (await PORegister.find({ corePoNumber: { $in: poNumbers }, isDeleted: false }).lean()) as unknown as PoRegisterLean[];
    const poRegisterMap = new Map(poRegisters.map(po => [po.corePoNumber, po]));

    let list = poSummaries.map(p => {
        const poNumber = p._id as string;
        const register = poRegisterMap.get(poNumber);

        let orderedQty: number | undefined;
        let dispatchedQty = 0;
        let status: "FULLY_DISPATCHED" | "PARTIALLY_DISPATCHED" | "NOT_DISPATCHED" | "PO_NOT_FOUND";

        if (register) {
            orderedQty = register.items.reduce((sum, item) => sum + item.quantity, 0);
            dispatchedQty = register.items.reduce(
                (sum, item) => sum + (dispatchedMap.get(`${poNumber}::${item.itemCode}`) ?? 0),
                0
            );
            status = dispatchedQty === 0 ? "NOT_DISPATCHED" : dispatchedQty >= orderedQty ? "FULLY_DISPATCHED" : "PARTIALLY_DISPATCHED";
        } else {
            for (const [key, qty] of dispatchedMap.entries()) {
                if (key.startsWith(`${poNumber}::`)) dispatchedQty += qty;
            }
            status = "PO_NOT_FOUND";
        }

        return {
            poNumber,
            jobNumber: register?.jobNumber,
            companyName: register?.companyName || p.companyName,
            poDate: register?.poDate,
            status,
            orderedQty,
            dispatchedQty,
            pendingQty: orderedQty !== undefined ? Math.max(0, orderedQty - dispatchedQty) : undefined,
            invoiceCount: (p.invoiceNumbers as string[]).length,
            lastDispatchDate: p.lastDispatchDate,
        };
    });

    if (search) {
        list = list.filter(
            p => p.poNumber.toLowerCase().includes(search) || (p.companyName || "").toLowerCase().includes(search)
        );
    }

    list.sort((a, b) => new Date(b.lastDispatchDate).getTime() - new Date(a.lastDispatchDate).getTime());

    const total = list.length;
    const totalPages = Math.ceil(total / size);
    const data = list.slice((page - 1) * size, page * size);

    res.status(200).json(
        new ApiResponse(200, { data, total, totalPages, page, size }, "PO dispatch list fetched successfully")
    );
});

/**
 * Full dispatch detail for one PO: per-item ordered vs dispatched, plus every
 * individual dispatch event (invoice, date, qty, consignment, transporter)
 * that contributed to it.
 */
export const getPoDispatchDetail = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { poNumber } = req.params;
    const financialYear = (req.query.financialYear as string) || "";
    const salesFilter: Record<string, unknown> = { poNumber, isDeleted: false };
    if (financialYear) salesFilter.financialYear = financialYear;

    const [register, salesRows] = await Promise.all([
        PORegister.findOne({ corePoNumber: poNumber, isDeleted: false }).lean() as unknown as Promise<PoRegisterLean | null>,
        Sales.find(salesFilter).sort({ dispatchDate: 1 }).lean(),
    ]);

    if (!register && salesRows.length === 0) {
        throw new ApiError(404, "No PO or dispatch records found for this PO number");
    }

    const itemCodesFromRegister = register?.items.map(i => i.itemCode) ?? [];
    const itemCodesFromSales = [...new Set(salesRows.map(s => s.itemCode))];
    const allItemCodes = [...new Set([...itemCodesFromRegister, ...itemCodesFromSales])];

    const items = allItemCodes.map(itemCode => {
        const registerItem = register?.items.find(i => i.itemCode === itemCode);
        const events = salesRows
            .filter(s => s.itemCode === itemCode)
            .map(s => ({
                invoiceNumber: s.invoiceNumber,
                dispatchDate: s.dispatchDate,
                quantity: s.quantity,
                uom: s.uom,
                consignmentNumber: s.consignmentNumber,
                transporterName: s.transporterName,
                ewayBillNumber: s.ewayBillNumber,
            }));
        const dispatchedQty = events.reduce((sum, e) => sum + e.quantity, 0);
        const orderedQty = registerItem?.quantity;

        return {
            itemCode,
            itemDescription: registerItem?.itemDescription || salesRows.find(s => s.itemCode === itemCode)?.itemName || "",
            orderedQty,
            dispatchedQty,
            pendingQty: orderedQty !== undefined ? Math.max(0, orderedQty - dispatchedQty) : undefined,
            dispatchEvents: events,
        };
    });

    res.status(200).json(
        new ApiResponse(
            200,
            {
                poNumber,
                jobNumber: register?.jobNumber,
                companyName: register?.companyName || salesRows[0]?.companyName,
                poDate: register?.poDate,
                poFoundInRegister: !!register,
                items,
            },
            "PO dispatch detail fetched successfully"
        )
    );
});
