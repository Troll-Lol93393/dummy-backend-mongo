import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Party } from "../models/party.model";
import { RawMaterialType } from "../models/rawMaterialType.model";
import { LabourProcessType } from "../models/labourProcessType.model";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import * as fs from "fs";

const VALID_PARTY_TYPES = ["RAW_MATERIAL_DEALER", "LABOUR_JOB_WORKER", "COMPLETE_SUPPLY"];

const PARTY_TYPE_MODEL_MAP: Record<string, string> = {
    RAW_MATERIAL_DEALER: "RawMaterialType",
    LABOUR_JOB_WORKER: "LabourProcessType",
};

const getPopulateModel = (partyType: string): string => {
    return PARTY_TYPE_MODEL_MAP[partyType] || "RawMaterialType";
};

export const createParty = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { partyType, partySubType } = req.body;

        if (!partyType) {
            throw new ApiError(400, "Party type is required");
        }

        if (!VALID_PARTY_TYPES.includes(partyType)) {
            throw new ApiError(
                400,
                "Party type must be RAW_MATERIAL_DEALER, LABOUR_JOB_WORKER, or COMPLETE_SUPPLY"
            );
        }

        // partySubType is required for RAW_MATERIAL_DEALER and LABOUR_JOB_WORKER
        if (partyType !== "COMPLETE_SUPPLY") {
            if (!partySubType) {
                throw new ApiError(400, "Party sub type is required for this party type");
            }

            if (!mongoose.Types.ObjectId.isValid(partySubType)) {
                throw new ApiError(400, "Invalid party sub type ID");
            }

            // Validate that the partySubType exists in the correct collection
            if (partyType === "RAW_MATERIAL_DEALER") {
                const rawMaterialType = await RawMaterialType.findById(partySubType);
                if (!rawMaterialType) {
                    throw new ApiError(
                        404,
                        "Raw material type not found for the given partySubType"
                    );
                }
            } else {
                const labourProcessType =
                    await LabourProcessType.findById(partySubType);
                if (!labourProcessType) {
                    throw new ApiError(
                        404,
                        "Labour process type not found for the given partySubType"
                    );
                }
            }
        }

        const newParty = await Party.create(req.body);

        res.status(201).json(
            new ApiResponse(201, newParty, "Party created successfully !")
        );
    }
);

export const getAllParties = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;
        const partyType = req.query.partyType as string;

        const filter: Record<string, unknown> = { isDeleted: false };

        // Filter by partyType if provided
        if (partyType) {
            if (VALID_PARTY_TYPES.includes(partyType)) {
                filter.partyType = partyType;
            } else if (partyType === "RAW_MATERIAL") {
                // For raw material costing: show RAW_MATERIAL_DEALER + COMPLETE_SUPPLY
                filter.partyType = { $in: ["RAW_MATERIAL_DEALER", "COMPLETE_SUPPLY"] };
            } else if (partyType === "LABOUR") {
                // For labour costing: show LABOUR_JOB_WORKER + COMPLETE_SUPPLY
                filter.partyType = { $in: ["LABOUR_JOB_WORKER", "COMPLETE_SUPPLY"] };
            }
        }

        if (search) {
            filter.$or = [
                { acName: { $regex: search, $options: "i" } },
                { cpName: { $regex: search, $options: "i" } },
                { mobile: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { gstin: { $regex: search, $options: "i" } },
            ];
        }

        const totalCount = await Party.countDocuments(filter);
        const parties = await Party.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        // Populate partySubType based on each party's partyType
        const populatedParties = await Promise.all(
            parties.map(async party => {
                if (party.partyType === "COMPLETE_SUPPLY" || !party.partySubType) {
                    return party;
                }
                const modelName = getPopulateModel(party.partyType);
                return Party.populate(party, {
                    path: "partySubType",
                    model: modelName,
                });
            })
        );

        res.status(200).json(
            new ApiResponse(200, {
                data: populatedParties,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Parties fetched successfully !")
        );
    }
);

export const getParty = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const partyId = req.params.partyId;

        if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
            throw new ApiError(400, "Invalid party ID");
        }

        const party = await Party.findOne({
            _id: partyId,
            isDeleted: false,
        });

        if (!party) {
            throw new ApiError(404, "Party not found");
        }

        if (party.partyType !== "COMPLETE_SUPPLY" && party.partySubType) {
            const modelName = getPopulateModel(party.partyType);
            await Party.populate(party, {
                path: "partySubType",
                model: modelName,
            });
        }

        res.status(200).json(
            new ApiResponse(200, party, "Party fetched successfully !")
        );
    }
);

export const updateParty = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const partyId = req.params.partyId;

        if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
            throw new ApiError(400, "Invalid party ID");
        }

        const party = await Party.findOne({
            _id: partyId,
            isDeleted: false,
        });

        if (!party) {
            throw new ApiError(404, "Party not found");
        }

        // If partyType or partySubType is being updated, validate them
        const partyType = req.body.partyType || party.partyType;
        const partySubType = req.body.partySubType || party.partySubType;

        if (req.body.partyType && !VALID_PARTY_TYPES.includes(req.body.partyType)) {
            throw new ApiError(
                400,
                "Party type must be RAW_MATERIAL_DEALER, LABOUR_JOB_WORKER, or COMPLETE_SUPPLY"
            );
        }

        if (partyType !== "COMPLETE_SUPPLY" && req.body.partySubType) {
            if (!mongoose.Types.ObjectId.isValid(req.body.partySubType)) {
                throw new ApiError(400, "Invalid party sub type ID");
            }

            if (partyType === "RAW_MATERIAL_DEALER") {
                const rawMaterialType = await RawMaterialType.findById(
                    partySubType
                );
                if (!rawMaterialType) {
                    throw new ApiError(
                        404,
                        "Raw material type not found for the given partySubType"
                    );
                }
            } else if (partyType === "LABOUR_JOB_WORKER") {
                const labourProcessType =
                    await LabourProcessType.findById(partySubType);
                if (!labourProcessType) {
                    throw new ApiError(
                        404,
                        "Labour process type not found for the given partySubType"
                    );
                }
            }
        }

        const updatedParty = await Party.findByIdAndUpdate(
            partyId,
            req.body,
            { new: true }
        );

        res.status(200).json(
            new ApiResponse(200, updatedParty, "Party updated successfully !")
        );
    }
);

export const deleteParty = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const partyId = req.params.partyId;

        if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) {
            throw new ApiError(400, "Invalid party ID");
        }

        const party = await Party.findOne({
            _id: partyId,
            isDeleted: false,
        });

        if (!party) {
            throw new ApiError(404, "Party not found");
        }

        party.isDeleted = true;
        await party.save();

        res.status(200).json(
            new ApiResponse(200, party, "Party soft deleted successfully !")
        );
    }
);

// Flexible column alias map: lowercase alias -> model field
const PARTY_COLUMN_ALIASES: Record<string, string> = {
    // acName
    acname: "acName", "ac name": "acName", "account name": "acName", "party name": "acName", "name": "acName", "firm name": "acName", "company": "acName", "company name": "acName",
    // cpName
    cpname: "cpName", "cp name": "cpName", "contact person": "cpName", "contact name": "cpName", "contact": "cpName",
    // mobile
    mobile: "mobile", "mobile no": "mobile", "mobile number": "mobile", "mob": "mobile", "cell": "mobile",
    // phone
    phone: "phone", "phone no": "phone", "phone number": "phone", "telephone": "phone", "tel": "phone", "landline": "phone",
    // email
    email: "email", "e-mail": "email", "email id": "email", "emailid": "email", "mail": "email",
    // addresses
    add1: "add1", "address 1": "add1", "address1": "add1", "address line 1": "add1", "addressline1": "add1", "address": "add1",
    add2: "add2", "address 2": "add2", "address2": "add2", "address line 2": "add2", "addressline2": "add2",
    add3: "add3", "address 3": "add3", "address3": "add3", "address line 3": "add3", "addressline3": "add3",
    // pin
    pin: "pin", pincode: "pin", "pin code": "pin", "zip": "pin", "zip code": "pin", "postal code": "pin",
    // tax identifiers
    cin: "cin", vat: "vat", "vat no": "vat", cst: "cst", "cst no": "cst",
    pan: "pan", "pan no": "pan", "pan number": "pan",
    tan: "tan", "tan no": "tan", "tan number": "tan",
    range: "range",
    tin: "tin", "tin no": "tin", "tin number": "tin",
    ecc: "ecc", "ecc no": "ecc",
    stregn: "stregn", "st regn": "stregn", "st registration": "stregn", "service tax": "stregn",
    // state
    state: "state", "state name": "state",
    statecd: "statecd", "state cd": "statecd", "state code": "statecd", "statecode": "statecd",
    // gstin
    gstin: "gstin", "gst": "gstin", "gst no": "gstin", "gst number": "gstin", "gstin no": "gstin",
    // partyType
    partytype: "partyType", "party type": "partyType", "type": "partyType",
    // partySubType
    partysubtype: "partySubType", "party sub type": "partySubType", "sub type": "partySubType", "subtype": "partySubType", "category": "partySubType",
};

// Friendly party type aliases -> model enum
const PARTY_TYPE_ALIASES: Record<string, string> = {
    raw_material_dealer: "RAW_MATERIAL_DEALER",
    "raw material dealer": "RAW_MATERIAL_DEALER",
    "raw material": "RAW_MATERIAL_DEALER",
    "raw dealer": "RAW_MATERIAL_DEALER",
    dealer: "RAW_MATERIAL_DEALER",
    material: "RAW_MATERIAL_DEALER",
    labour_job_worker: "LABOUR_JOB_WORKER",
    "labour job worker": "LABOUR_JOB_WORKER",
    labour: "LABOUR_JOB_WORKER",
    "job worker": "LABOUR_JOB_WORKER",
    "job work": "LABOUR_JOB_WORKER",
    labor: "LABOUR_JOB_WORKER",
    complete_supply: "COMPLETE_SUPPLY",
    "complete supply": "COMPLETE_SUPPLY",
    supply: "COMPLETE_SUPPLY",
    "complete": "COMPLETE_SUPPLY",
};

const resolvePartyType = (value: string): string | null => {
    const cleaned = value.trim();
    if (VALID_PARTY_TYPES.includes(cleaned)) return cleaned;
    return PARTY_TYPE_ALIASES[cleaned.toLowerCase()] || null;
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

const isRowEmpty = (row: Record<string, unknown>): boolean => {
    return Object.values(row).every(v => v === undefined || v === null || String(v).trim() === "");
};

const readExcelFile = (file: Express.Multer.File): Record<string, unknown>[] => {
    const filePath = file.path;
    const allowedExtensions = [".xlsx", ".xls", ".csv"];
    const fileExtension = file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase();

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

    return rows;
};

export const importPartiesFromExcel = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) throw new ApiError(400, "Excel file is required");

        const filePath = req.file.path;
        const rows = readExcelFile(req.file);

        // Pre-load sub-type lookup caches (name -> _id)
        const [rawMaterialTypes, labourProcessTypes] = await Promise.all([
            RawMaterialType.find({}).lean(),
            LabourProcessType.find({}).lean(),
        ]);

        const rawMaterialMap = new Map<string, string>();
        for (const rmt of rawMaterialTypes) {
            rawMaterialMap.set((rmt as Record<string, unknown> & { name: string }).name.toLowerCase(), String(rmt._id));
        }

        const labourProcessMap = new Map<string, string>();
        for (const lpt of labourProcessTypes) {
            labourProcessMap.set((lpt as Record<string, unknown> & { name: string }).name.toLowerCase(), String(lpt._id));
        }

        const successCount: number[] = [];
        const errors: { row: number; message: string }[] = [];
        const partiesToInsert: Record<string, unknown>[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const rowIndex = i + 2;

            if (isRowEmpty(row)) continue;

            try {
                const partyData = mapExcelRow(row, PARTY_COLUMN_ALIASES);

                // At minimum, need acName or some identifier
                if (!partyData.acName && !partyData.cpName && !partyData.mobile && !partyData.email && !partyData.gstin) {
                    errors.push({ row: rowIndex, message: "Row has no identifiable party data (need at least name, contact person, mobile, email, or GSTIN)" });
                    continue;
                }

                // Resolve partyType
                if (partyData.partyType) {
                    const resolved = resolvePartyType(partyData.partyType);
                    if (!resolved) {
                        errors.push({ row: rowIndex, message: `Invalid partyType: "${partyData.partyType}". Use: Raw Material Dealer, Labour Job Worker, or Complete Supply` });
                        continue;
                    }
                    partyData.partyType = resolved;
                } else {
                    errors.push({ row: rowIndex, message: "partyType is required" });
                    continue;
                }

                // Resolve partySubType — accept ObjectId or name lookup
                if (partyData.partyType !== "COMPLETE_SUPPLY") {
                    if (!partyData.partySubType) {
                        errors.push({ row: rowIndex, message: "partySubType (category name or ID) is required for this party type" });
                        continue;
                    }

                    if (mongoose.Types.ObjectId.isValid(partyData.partySubType)) {
                        // Already a valid ObjectId, keep as-is
                    } else {
                        // Try to resolve by name
                        const subTypeName = partyData.partySubType.toLowerCase();
                        const lookupMap = partyData.partyType === "RAW_MATERIAL_DEALER" ? rawMaterialMap : labourProcessMap;
                        const resolvedId = lookupMap.get(subTypeName);

                        if (!resolvedId) {
                            const typeName = partyData.partyType === "RAW_MATERIAL_DEALER" ? "raw material type" : "labour process type";
                            errors.push({ row: rowIndex, message: `Could not find ${typeName} named "${partyData.partySubType}"` });
                            continue;
                        }
                        partyData.partySubType = resolvedId;
                    }
                } else {
                    // COMPLETE_SUPPLY doesn't need partySubType
                    delete partyData.partySubType;
                }

                partiesToInsert.push(partyData);
                successCount.push(rowIndex);
            } catch (err: unknown) {
                errors.push({ row: rowIndex, message: (err as Error).message || "Unknown error" });
            }
        }

        // Bulk insert in batches of 100
        let insertedCount = 0;
        const insertErrors: { row: number; message: string }[] = [];

        for (let i = 0; i < partiesToInsert.length; i += 100) {
            const batch = partiesToInsert.slice(i, i + 100);
            try {
                const result = await Party.insertMany(batch, { ordered: false });
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
                    errorCount: allErrors.length,
                    errors: allErrors,
                },
                `Import completed: ${insertedCount} parties created, ${allErrors.length} rows failed`
            )
        );
    }
);
