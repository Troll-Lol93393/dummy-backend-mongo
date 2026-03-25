import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Client } from "../models/client.model";
import * as XLSX from "xlsx";
import * as fs from "fs";

export const getAllClients = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const all = req.query.all as string;

        // Return all non-deleted clients for dropdowns
        if (all === "true") {
            const clients = await Client.find({ isDeleted: false }).sort({ companyName: 1 }).lean();

            res.status(200).json(new ApiResponse(200, clients, "Clients fetched successfully"));
            return;
        }

        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "companyName";
        const sortOrder = (req.query.sortOrder as string) === "desc" ? -1 : 1;

        const filter: Record<string, unknown> = { isDeleted: false };

        if (search) {
            filter.$or = [
                { companyName: { $regex: search, $options: "i" } },
                { gstn: { $regex: search, $options: "i" } },
                { city: { $regex: search, $options: "i" } },
            ];
        }

        const allowedSortFields = [
            "companyName",
            "gstn",
            "location",
            "city",
            "state",
            "buyerName",
            "createdAt",
        ];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : "companyName";

        const totalCount = await Client.countDocuments(filter);
        const clients = await Client.find(filter)
            .sort({ [sortField]: sortOrder })
            .skip((page - 1) * size)
            .limit(size)
            .lean();

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    data: clients,
                    totalCount,
                    page,
                    size,
                    totalPages: Math.ceil(totalCount / size),
                },
                "Clients fetched successfully"
            )
        );
    }
);

export const getClientById = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const client = await Client.findOne({ _id: id, isDeleted: false });

        if (!client) {
            throw new ApiError(404, "Client not found");
        }

        res.status(200).json(new ApiResponse(200, client, "Client fetched successfully"));
    }
);

export const createClient = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const {
            companyName,
            gstn,
            location,
            addressLine1,
            addressLine2,
            addressLine3,
            state,
            city,
            pincode,
            country,
            buyerName,
            buyerContact,
        } = req.body;

        if (!companyName || companyName.trim() === "") {
            throw new ApiError(400, "Company name is required");
        }

        // Check uniqueness among non-deleted clients
        const existing = await Client.findOne({
            companyName: companyName.trim(),
            isDeleted: false,
        });
        if (existing) {
            throw new ApiError(409, "A client with this company name already exists");
        }

        const newClient = await Client.create({
            companyName,
            gstn,
            location,
            addressLine1,
            addressLine2,
            addressLine3,
            state,
            city,
            pincode,
            country,
            buyerName,
            buyerContact,
            isDeleted: false,
        });

        res.status(201).json(new ApiResponse(201, newClient, "Client created successfully"));
    }
);

export const updateClient = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const {
            companyName,
            gstn,
            location,
            addressLine1,
            addressLine2,
            addressLine3,
            state,
            city,
            pincode,
            country,
            buyerName,
            buyerContact,
        } = req.body;

        const client = await Client.findOne({ _id: id, isDeleted: false });
        if (!client) {
            throw new ApiError(404, "Client not found");
        }

        // Check companyName uniqueness if changed
        if (companyName !== undefined && companyName.trim() !== client.companyName) {
            const existing = await Client.findOne({
                companyName: companyName.trim(),
                isDeleted: false,
                _id: { $ne: id },
            });
            if (existing) {
                throw new ApiError(409, "A client with this company name already exists");
            }
        }

        if (companyName !== undefined) client.companyName = companyName;
        if (gstn !== undefined) client.gstn = gstn;
        if (location !== undefined) client.location = location;
        if (addressLine1 !== undefined) client.addressLine1 = addressLine1;
        if (addressLine2 !== undefined) client.addressLine2 = addressLine2;
        if (addressLine3 !== undefined) client.addressLine3 = addressLine3;
        if (state !== undefined) client.state = state;
        if (city !== undefined) client.city = city;
        if (pincode !== undefined) client.pincode = pincode;
        if (country !== undefined) client.country = country;
        if (buyerName !== undefined) client.buyerName = buyerName;
        if (buyerContact !== undefined) client.buyerContact = buyerContact;

        await client.save();

        res.status(200).json(new ApiResponse(200, client, "Client updated successfully"));
    }
);

export const deleteClient = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const client = await Client.findByIdAndUpdate(id, { isDeleted: true }, { new: true });

        if (!client) {
            throw new ApiError(404, "Client not found");
        }

        res.status(200).json(new ApiResponse(200, client, "Client deleted successfully"));
    }
);

// Flexible column alias map for client import
const CLIENT_COLUMN_ALIASES: Record<string, string> = {
    // companyName
    companyname: "companyName", "company name": "companyName", "company": "companyName", "name": "companyName",
    "firm name": "companyName", "firm": "companyName", "client name": "companyName", "client": "companyName",
    "party name": "companyName", "organization": "companyName", "org": "companyName",
    // gstn
    gstn: "gstn", gst: "gstn", gstin: "gstn", "gst no": "gstn", "gst number": "gstn", "gstin no": "gstn", "gst in": "gstn",
    // location
    location: "location", "loc": "location", "place": "location",
    // addressLine1
    addressline1: "addressLine1", "address line 1": "addressLine1", "address 1": "addressLine1", "address1": "addressLine1",
    "address line1": "addressLine1", address: "addressLine1", "add1": "addressLine1",
    // addressLine2
    addressline2: "addressLine2", "address line 2": "addressLine2", "address 2": "addressLine2", "address2": "addressLine2",
    "address line2": "addressLine2", "add2": "addressLine2",
    // addressLine3
    addressline3: "addressLine3", "address line 3": "addressLine3", "address 3": "addressLine3", "address3": "addressLine3",
    "address line3": "addressLine3", "add3": "addressLine3",
    // state
    state: "state", "state name": "state",
    // city
    city: "city", "city name": "city", town: "city",
    // pincode
    pincode: "pincode", "pin code": "pincode", pin: "pincode", "zip": "pincode", "zip code": "pincode", "postal code": "pincode",
    // country
    country: "country", "nation": "country",
    // buyerName
    buyername: "buyerName", "buyer name": "buyerName", "buyer": "buyerName", "contact person": "buyerName",
    "contact name": "buyerName", "contact": "buyerName", "poc": "buyerName", "point of contact": "buyerName",
    // buyerContact
    buyercontact: "buyerContact", "buyer contact": "buyerContact", "buyer phone": "buyerContact",
    "buyer mobile": "buyerContact", "contact number": "buyerContact", "contact phone": "buyerContact",
    "phone": "buyerContact", "mobile": "buyerContact", "phone no": "buyerContact", "mobile no": "buyerContact",
};

const isRowEmpty = (row: Record<string, unknown>): boolean => {
    return Object.values(row).every(v => v === undefined || v === null || String(v).trim() === "");
};

const mapExcelRow = (row: Record<string, unknown>, aliasMap: Record<string, string>): Record<string, string> => {
    const mapped: Record<string, string> = {};
    for (const [excelCol, value] of Object.entries(row)) {
        if (value === undefined || value === null || String(value).trim() === "") continue;
        const normalizedCol = excelCol.trim().toLowerCase().replace(/[_\-\.]+/g, " ").replace(/\s+/g, " ");
        const modelField = aliasMap[normalizedCol];
        if (modelField && !mapped[modelField]) {
            mapped[modelField] = String(value).trim();
        }
    }
    return mapped;
};

export const importClientsFromExcel = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) throw new ApiError(400, "Excel file is required");

        const filePath = req.file.path;
        const allowedExtensions = [".xlsx", ".xls", ".csv"];
        const fileExtension = req.file.originalname.substring(req.file.originalname.lastIndexOf(".")).toLowerCase();

        if (!allowedExtensions.includes(fileExtension)) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            throw new ApiError(400, "Only .xlsx, .xls, and .csv files are allowed");
        }

        let workbook: XLSX.WorkBook;
        try {
            workbook = XLSX.readFile(filePath);
        } catch {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            throw new ApiError(400, "Failed to read the Excel file");
        }

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            throw new ApiError(400, "Excel file has no sheets");
        }

        const sheet = workbook.Sheets[sheetName];
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet!);

        if (!rows || rows.length === 0) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            throw new ApiError(400, "Excel file is empty or has no valid rows");
        }

        // Pre-load existing non-deleted client names for duplicate detection
        const existingClients = await Client.find({ isDeleted: false }).select("companyName").lean();
        const existingNames = new Set(existingClients.map(c => c.companyName.toLowerCase()));

        const successCount: number[] = [];
        const skipped: { row: number; message: string }[] = [];
        const errors: { row: number; message: string }[] = [];
        const clientsToInsert: Record<string, unknown>[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const rowIndex = i + 2;

            if (isRowEmpty(row)) continue;

            try {
                const clientData = mapExcelRow(row, CLIENT_COLUMN_ALIASES);

                if (!clientData.companyName) {
                    errors.push({ row: rowIndex, message: "Company name is required (could not find a matching column)" });
                    continue;
                }

                // Check for duplicate
                if (existingNames.has(clientData.companyName.toLowerCase())) {
                    skipped.push({ row: rowIndex, message: `Client "${clientData.companyName}" already exists — skipped` });
                    continue;
                }

                // Track for in-batch duplicate detection
                existingNames.add(clientData.companyName.toLowerCase());

                clientsToInsert.push({ ...clientData, isDeleted: false });
                successCount.push(rowIndex);
            } catch (err: unknown) {
                errors.push({ row: rowIndex, message: (err as Error).message || "Unknown error" });
            }
        }

        // Bulk insert in batches of 100
        let insertedCount = 0;
        const insertErrors: { row: number; message: string }[] = [];

        for (let i = 0; i < clientsToInsert.length; i += 100) {
            const batch = clientsToInsert.slice(i, i + 100);
            try {
                const result = await Client.insertMany(batch, { ordered: false });
                insertedCount += result.length;
            } catch (err: unknown) {
                const bulkErr = err as { writeErrors?: { index: number; errmsg: string }[]; insertedDocs?: unknown[] };
                if (bulkErr.writeErrors) {
                    for (const writeErr of bulkErr.writeErrors) {
                        const globalIdx = i + writeErr.index;
                        insertErrors.push({ row: successCount[globalIdx] ?? globalIdx + 2, message: writeErr.errmsg });
                    }
                    insertedCount += (batch.length - (bulkErr.writeErrors?.length ?? 0));
                } else {
                    for (let j = 0; j < batch.length; j++) {
                        insertErrors.push({ row: successCount[i + j] ?? (i + j + 2), message: (err as Error).message || "Insert failed" });
                    }
                }
            }
        }

        // Clean up
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        const allErrors = [...errors, ...insertErrors];

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    totalRows: rows.length,
                    successCount: insertedCount,
                    skippedCount: skipped.length,
                    errorCount: allErrors.length,
                    skipped,
                    errors: allErrors,
                },
                `Import completed: ${insertedCount} clients created, ${skipped.length} skipped (duplicates), ${allErrors.length} rows failed`
            )
        );
    }
);
