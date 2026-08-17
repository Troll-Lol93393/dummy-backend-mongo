import { Request, Response, NextFunction } from "express";
import fs from "fs";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { PORegister } from "../models/poRegister.model";
import { Client } from "../models/client.model";
import { extractCorePoNumber } from "../utils/poNumber";

interface ParsedLineItem {
    serialNumber: number;
    itemCode: string;
    itemDescription: string;
    drawingNumber: string;
    quantity: number;
    rate: number;
    basicValue: number;
    igst: number;
    roundOff: number;
    netAmount: number;
}

interface ParsedPO {
    poNumber: string;
    jobNumber: string;
    poDate: Date | undefined;
    deliveryDate: Date | undefined;
    companyName: string;
    items: ParsedLineItem[];
    totalBasicValue: number;
    totalTax: number;
    totalRoundOff: number;
    totalNetAmount: number;
}

const parseExcelDate = (val: unknown): Date | undefined => {
    if (!val) return undefined;
    // If it's already a Date object or number (Excel serial date)
    if (typeof val === "number") {
        // Excel serial date
        const date = new Date((val - 25569) * 86400 * 1000);
        return isNaN(date.getTime()) ? undefined : date;
    }
    if (typeof val === "string") {
        // Try DD/MM/YYYY format
        const parts = val.split("/");
        if (parts.length === 3) {
            const d = parseInt(parts[0]!, 10);
            const m = parseInt(parts[1]!, 10) - 1;
            const y = parseInt(parts[2]!, 10);
            const date = new Date(y, m, d);
            return isNaN(date.getTime()) ? undefined : date;
        }
        // Try ISO or other formats
        const date = new Date(val);
        return isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
};

export const getAllPORegisters = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 20;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "poDate";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;
        const companyName = (req.query.companyName as string) || "";

        const filter: Record<string, unknown> = { isDeleted: false };

        if (companyName) {
            filter.companyName = companyName;
        }

        if (search) {
            filter.$or = [
                { poNumber: { $regex: search, $options: "i" } },
                { jobNumber: { $regex: search, $options: "i" } },
                { companyName: { $regex: search, $options: "i" } },
                { "items.itemCode": { $regex: search, $options: "i" } },
            ];
        }

        const allowedSortFields = [
            "poNumber",
            "jobNumber",
            "poDate",
            "companyName",
            "totalBasicValue",
            "totalNetAmount",
            "deliveryDate",
        ];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : "poDate";

        const total = await PORegister.countDocuments(filter);
        const totalPages = Math.ceil(total / size);
        const data = await PORegister.find(filter)
            .sort({ [sortField]: sortOrder })
            .skip((page - 1) * size)
            .limit(size)
            .lean();

        res.status(200).json(
            new ApiResponse(
                200,
                { data, total, totalPages, page, size },
                "PO Registers fetched successfully"
            )
        );
    }
);

export const getPORegisterById = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id!)) {
            throw new ApiError(400, "Invalid PO Register ID");
        }

        const po = await PORegister.findOne({ _id: id, isDeleted: false });
        if (!po) {
            throw new ApiError(404, "PO Register not found");
        }

        res.status(200).json(new ApiResponse(200, po, "PO Register fetched successfully"));
    }
);

export const importPORegisters = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) {
            throw new ApiError(400, "No file uploaded");
        }

        const filePath = req.file.path;

        try {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                throw new ApiError(400, "Excel file has no sheets");
            }
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) {
                throw new ApiError(400, "Could not read the first sheet");
            }

            const rows: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                raw: true,
                dateNF: "dd/mm/yyyy",
            });

            const DATA_START_ROW = 29;
            let currentPO: ParsedPO | null = null;
            const allPOs: ParsedPO[] = [];

            // SheetJS column indices (differ from xlrd due to merged cells)
            // col 1=Job Number, 5=PO Date, 9=Job No (redundant), 14=Delivery Date,
            // 17=PO Number (VJNR/...), 21=Drawing No, 22=Company/Total,
            // 26=Qty, 28=Rate, 30=Basic Value
            // 33=SGST, 35=CGST, 38=IGST, 40=Round Off, 43=Net Amount
            for (let i = DATA_START_ROW; i < rows.length; i++) {
                const row = rows[i]!;
                const colPO = row[1]; // Job Number (numeric like 1000)
                const colDate = row[5]; // PO Date or Serial No
                const colJob = row[9]; // Job Number (redundant) or Item Code
                const colRef = row[14]; // Delivery Date or Item Description
                const colPR = row[17]; // PO Number (VJNR/... string)
                const colDwg = row[21]; // Drawing Number
                const colCompany = row[22]; // Company Name or "T o t a l"
                const colQty = row[26]; // Quantity
                const colRate = row[28]; // Rate
                const colBasic = row[30]; // Basic Value
                const colIGST = row[38]; // IGST / Tax
                const colRoff = row[40]; // Round Off
                const colNet = row[43]; // Net Amount

                // New PO header: col 1 has a job number value (numeric string like "1000")
                const jobNum = typeof colPO === "number" ? colPO : parseInt(String(colPO), 10);
                if (
                    colPO !== undefined &&
                    colPO !== "" &&
                    !isNaN(jobNum) &&
                    String(colPO) !== "Total"
                ) {
                    if (currentPO) allPOs.push(currentPO);
                    currentPO = {
                        poNumber: String(colPR ?? ""),
                        jobNumber: String(jobNum),
                        poDate: parseExcelDate(colDate),
                        deliveryDate: parseExcelDate(colRef),
                        companyName: String(colCompany ?? ""),
                        items: [],
                        totalBasicValue: 0,
                        totalTax: 0,
                        totalRoundOff: 0,
                        totalNetAmount: 0,
                    };
                    continue;
                }

                if (!currentPO) continue;

                // Total row
                if (typeof colCompany === "string" && colCompany.includes("T o t a l")) {
                    currentPO.totalBasicValue = Number(colBasic) || 0;
                    currentPO.totalTax = Number(colIGST) || 0;
                    currentPO.totalRoundOff = Number(colRoff) || 0;
                    currentPO.totalNetAmount = Number(colNet) || 0;
                    continue;
                }

                // Line item: colDate has a serial number (like 1, 2, 3)
                if (
                    colDate !== undefined &&
                    colDate !== "" &&
                    typeof colDate === "number" &&
                    colDate > 0 &&
                    colDate < 1000
                ) {
                    currentPO.items.push({
                        serialNumber: colDate,
                        itemCode: String(colJob ?? ""),
                        itemDescription: String(colRef ?? ""),
                        drawingNumber: String(colDwg ?? ""),
                        quantity: Number(colQty) || 0,
                        rate: Number(colRate) || 0,
                        basicValue: Number(colBasic) || 0,
                        igst: Number(colIGST) || 0,
                        roundOff: Number(colRoff) || 0,
                        netAmount: Number(colNet) || 0,
                    });
                    continue;
                }

                // Description continuation: colRef has text, nothing else meaningful
                if (colRef && currentPO.items.length > 0) {
                    const lastItem = currentPO.items[currentPO.items.length - 1]!;
                    lastItem.itemDescription += "\n" + String(colRef);
                }
            }
            // Don't forget the last PO
            if (currentPO) allPOs.push(currentPO);

            // Auto-create clients from unique company names
            const uniqueCompanies = [...new Set(allPOs.map(po => po.companyName).filter(Boolean))];
            const clientMap = new Map<string, mongoose.Types.ObjectId>();

            if (uniqueCompanies.length > 0) {
                const clientBulkOps = uniqueCompanies.map(name => ({
                    updateOne: {
                        filter: { companyName: name, isDeleted: false },
                        update: { $setOnInsert: { companyName: name, isDeleted: false } },
                        upsert: true,
                    },
                }));
                await Client.bulkWrite(clientBulkOps);

                // Fetch all clients to build the lookup map
                const clients = await Client.find({
                    companyName: { $in: uniqueCompanies },
                    isDeleted: false,
                }).lean();
                for (const c of clients) {
                    clientMap.set(c.companyName, c._id as mongoose.Types.ObjectId);
                }
            }

            // Upsert POs in batches, linking client reference
            const bulkOps = allPOs.map(po => {
                const clientId = clientMap.get(po.companyName);
                return {
                    updateOne: {
                        filter: { jobNumber: po.jobNumber },
                        update: {
                            $set: {
                                ...po,
                                corePoNumber: extractCorePoNumber(po.poNumber),
                                client: clientId ?? undefined,
                                isDeleted: false,
                            },
                        },
                        upsert: true,
                    },
                };
            });

            let imported = 0;
            for (let i = 0; i < bulkOps.length; i += 100) {
                const chunk = bulkOps.slice(i, i + 100);
                const result = await PORegister.bulkWrite(chunk);
                imported += result.upsertedCount + result.modifiedCount;
            }

            res.status(200).json(
                new ApiResponse(
                    200,
                    {
                        imported: allPOs.length,
                        total: allPOs.length,
                        clientsCreated: uniqueCompanies.length,
                    },
                    "PO Registers imported successfully"
                )
            );
        } finally {
            // Clean up temp file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    }
);

export const deletePORegister = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id!)) {
            throw new ApiError(400, "Invalid PO Register ID");
        }

        const po = await PORegister.findByIdAndUpdate(id, { isDeleted: true }, { new: true });
        if (!po) {
            throw new ApiError(404, "PO Register not found");
        }

        res.status(200).json(new ApiResponse(200, po, "PO Register deleted successfully"));
    }
);

export const getPOStats = asyncHandler(
    async (_req: Request, res: Response, _next: NextFunction) => {
        const stats = await PORegister.aggregate([
            { $match: { isDeleted: false } },
            {
                $facet: {
                    overview: [
                        {
                            $group: {
                                _id: null,
                                totalPOs: { $sum: 1 },
                                totalValue: { $sum: "$totalNetAmount" },
                                companies: { $addToSet: "$companyName" },
                            },
                        },
                    ],
                    byCompany: [
                        {
                            $group: {
                                _id: "$companyName",
                                count: { $sum: 1 },
                                totalValue: { $sum: "$totalNetAmount" },
                            },
                        },
                        { $sort: { totalValue: -1 } },
                    ],
                    byYear: [
                        {
                            $group: {
                                _id: { $year: "$poDate" },
                                count: { $sum: 1 },
                                totalValue: { $sum: "$totalNetAmount" },
                            },
                        },
                        { $sort: { _id: -1 } },
                    ],
                },
            },
        ]);

        res.status(200).json(new ApiResponse(200, stats[0] ?? {}, "PO Stats fetched successfully"));
    }
);
