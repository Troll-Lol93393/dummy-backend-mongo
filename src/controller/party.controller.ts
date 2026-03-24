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

export const importPartiesFromExcel = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        if (!req.file) {
            throw new ApiError(400, "Excel file is required");
        }

        const filePath = req.file.path;
        const allowedExtensions = [".xlsx", ".xls"];
        const fileExtension = req.file.originalname
            .substring(req.file.originalname.lastIndexOf("."))
            .toLowerCase();

        if (!allowedExtensions.includes(fileExtension)) {
            // Clean up the uploaded file
            fs.unlinkSync(filePath);
            throw new ApiError(400, "Only .xlsx and .xls files are allowed");
        }

        let workbook: XLSX.WorkBook;
        try {
            workbook = XLSX.readFile(filePath);
        } catch (err) {
            fs.unlinkSync(filePath);
            throw new ApiError(400, "Failed to read the Excel file");
        }

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            fs.unlinkSync(filePath);
            throw new ApiError(400, "Excel file has no sheets");
        }
        const sheet = workbook.Sheets[sheetName];
        const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet!);

        if (!rows || rows.length === 0) {
            fs.unlinkSync(filePath);
            throw new ApiError(400, "Excel file is empty or has no valid rows");
        }

        const successCount: number[] = [];
        const errors: { row: number; message: string }[] = [];

        // Column mapping: Excel column headers -> model fields
        const columnMap: Record<string, string> = {
            acName: "acName",
            cpName: "cpName",
            mobile: "mobile",
            phone: "phone",
            email: "email",
            add1: "add1",
            add2: "add2",
            add3: "add3",
            pin: "pin",
            cin: "cin",
            vat: "vat",
            cst: "cst",
            pan: "pan",
            tan: "tan",
            range: "range",
            tin: "tin",
            ecc: "ecc",
            stregn: "stregn",
            state: "state",
            statecd: "statecd",
            gstin: "gstin",
            partyType: "partyType",
            partySubType: "partySubType",
        };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const rowIndex = i + 2; // Excel row number (1-based, header is row 1)

            try {
                const partyData: Record<string, any> = {};

                for (const [excelCol, modelField] of Object.entries(
                    columnMap
                )) {
                    if (row[excelCol] !== undefined && row[excelCol] !== null) {
                        partyData[modelField] = String(row[excelCol]).trim();
                    }
                }

                if (!partyData.partyType) {
                    errors.push({
                        row: rowIndex,
                        message: "partyType is required",
                    });
                    continue;
                }

                if (!VALID_PARTY_TYPES.includes(partyData.partyType)) {
                    errors.push({
                        row: rowIndex,
                        message:
                            "partyType must be RAW_MATERIAL_DEALER, LABOUR_JOB_WORKER, or COMPLETE_SUPPLY",
                    });
                    continue;
                }

                if (partyData.partyType !== "COMPLETE_SUPPLY" && !partyData.partySubType) {
                    errors.push({
                        row: rowIndex,
                        message: "partySubType is required for this party type",
                    });
                    continue;
                }

                if (
                    partyData.partySubType &&
                    !mongoose.Types.ObjectId.isValid(partyData.partySubType)
                ) {
                    errors.push({
                        row: rowIndex,
                        message: "Invalid partySubType ID",
                    });
                    continue;
                }

                await Party.create(partyData);
                successCount.push(rowIndex);
            } catch (err: any) {
                errors.push({
                    row: rowIndex,
                    message: err.message || "Unknown error",
                });
            }
        }

        // Clean up the uploaded file
        fs.unlinkSync(filePath);

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    totalRows: rows.length,
                    successCount: successCount.length,
                    errorCount: errors.length,
                    errors,
                },
                `Import completed: ${successCount.length} parties created, ${errors.length} rows failed`
            )
        );
    }
);
