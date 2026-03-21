import { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { runExtractionPipeline, ExtractionResult } from "../services/extraction/extractionOrchestrator";
import { ParsedRfpData, ParsedItem } from "../services/extraction/docParser";
import { Item } from "../models/item.model";
import { RFQ } from "../models/rfq.models";
import { RFQItems } from "../models/rfqItems.model";
import { ItemTechSpecs } from "../models/item.techSpecs.model";
import { CommercialSpecs } from "../models/item.commercial.model";
import { uploadFileToCloudinary } from "../utils/cloudinary";

// POST /api/v1/rfp-extract/upload
// Upload RFP file → run 3-layer extraction → return extracted data (does NOT save to DB yet)
export const uploadAndExtract = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const file = req.file;
        if (!file) {
            throw new ApiError(400, "RFP file is required (doc, docx, or pdf)");
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (![".doc", ".docx", ".pdf"].includes(ext)) {
            // Cleanup uploaded file
            fs.unlinkSync(file.path);
            throw new ApiError(400, "Only .doc, .docx, and .pdf files are supported");
        }

        let extractionResult: ExtractionResult;
        try {
            extractionResult = await runExtractionPipeline(file.path, file.originalname);
        } catch (err: unknown) {
            // Don't delete file yet — user may want to retry
            const msg = err instanceof Error ? err.message : "Extraction pipeline failed";
            throw new ApiError(500, `Extraction failed: ${msg}`);
        }

        // Upload file to cloudinary for permanent storage
        let fileUrl = "";
        try {
            const cloudinaryResult = await uploadFileToCloudinary(file.path);
            fileUrl = cloudinaryResult?.secure_url || "";
        } catch {
            // Non-critical — file already on local disk
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    extraction: {
                        layer: extractionResult.layer,
                        status: extractionResult.status,
                        confidence: extractionResult.confidence,
                        errors: extractionResult.errors,
                    },
                    extractedData: extractionResult.data,
                    rawText: extractionResult.data.rawText,
                    fileUrl,
                    originalFilename: file.originalname,
                },
                extractionResult.success
                    ? `Data extracted via ${extractionResult.layer} layer (${extractionResult.status})`
                    : "Extraction failed — manual entry required. Raw text provided for reference."
            )
        );
    }
);

// POST /api/v1/rfp-extract/confirm
// Takes extracted/edited data and creates Item + RFQ + RFQItems in DB
export const confirmAndSave = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const {
            prNumber,
            supplyType,
            location,
            companyName,
            dueDate,
            ownerName,
            items,
        } = req.body;

        if (!prNumber || !location || !companyName) {
            throw new ApiError(400, "prNumber, location, and companyName are required");
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new ApiError(400, "At least one item is required");
        }

        // Check for duplicate RFQ
        const existingRfq = await RFQ.findOne({ prNumber, isDeleted: false });
        if (existingRfq) {
            throw new ApiError(409, `RFQ with PR number ${prNumber} already exists`);
        }

        const createdRfqItemIds: string[] = [];

        for (const rawItem of items as ParsedItem[]) {
            // Find or create Item in master
            let item = await Item.findOne({ itemCode: rawItem.itemCode, isDeleted: false });

            if (!item) {
                if (!rawItem.itemCode || !rawItem.itemName) {
                    throw new ApiError(
                        400,
                        `Item code and name are required for new item: ${rawItem.itemCode || "(empty)"}`
                    );
                }
                item = await Item.create({
                    itemCode: rawItem.itemCode,
                    itemName: rawItem.itemName,
                    itemDesc: rawItem.itemDesc || rawItem.itemName,
                    itemType: rawItem.itemType || "UNIT",
                    size: "",
                    isDeleted: false,
                });
            }

            // Create tech specs
            const techSpecs = await ItemTechSpecs.create({
                material: rawItem.technical?.material || "",
                diameter: rawItem.technical?.diameter || "",
                length: rawItem.technical?.length || "",
                weight: rawItem.technical?.weight || "",
                grade: rawItem.technical?.grade || "",
            });

            // Create commercial specs (empty — to be filled during costing)
            const commercialSpecs = await CommercialSpecs.create({
                currency: "INR",
                rawMaterialCost: 0,
                laborCost: 0,
                profitMargin: 0,
                totalCost: 0,
                packingCost: 0,
                shippingCost: 0,
                sellingPrice: 0,
                otherCosts: 0,
            });

            // Create RFQ line item
            const rfqItem = await RFQItems.create({
                item: item._id,
                quantity: rawItem.quantity || 1,
                drawingNumber: rawItem.drawingNumber || "",
                drawingUrl: "",
                itemTechSpecs: techSpecs._id,
                commercialSpecs: commercialSpecs._id,
                isDeleted: false,
            });

            createdRfqItemIds.push(rfqItem._id.toString());
        }

        // Create RFQ
        const rfq = await RFQ.create({
            prNumber,
            startDate: new Date(),
            dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // default 30 days
            ownerName: ownerName || "",
            companyName,
            location,
            items: createdRfqItemIds,
            isQuoted: false,
            isDeleted: false,
            status: "PREVIEW",
            createdBy: req.user?._id?.toString() || "",
            updatedBy: req.user?._id?.toString() || "",
        });

        // Populate the RFQ with items for response
        const populatedRfq = await RFQ.findById(rfq._id).populate({
            path: "items",
            populate: [
                { path: "item" },
                { path: "itemTechSpecs" },
                { path: "commercialSpecs" },
            ],
        });

        res.status(201).json(
            new ApiResponse(201, populatedRfq, "RFQ and items created successfully from extracted data")
        );
    }
);

// POST /api/v1/rfp-extract/bulk-upload
// Upload multiple RFP files at once → extract all → return results array
export const bulkUploadAndExtract = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            throw new ApiError(400, "At least one RFP file is required");
        }

        const results: {
            filename: string;
            extraction: {
                layer: string;
                status: string;
                confidence: number;
                errors: string[];
            };
            extractedData: ParsedRfpData;
            fileUrl: string;
        }[] = [];

        for (const file of files) {
            const ext = path.extname(file.originalname).toLowerCase();
            if (![".doc", ".docx", ".pdf"].includes(ext)) {
                results.push({
                    filename: file.originalname,
                    extraction: {
                        layer: "NONE",
                        status: "FAILED",
                        confidence: 0,
                        errors: [`Unsupported file type: ${ext}`],
                    },
                    extractedData: {
                        prNumber: "",
                        supplyType: "",
                        location: "",
                        companyName: "",
                        items: [],
                        rawText: "",
                    },
                    fileUrl: "",
                });
                continue;
            }

            try {
                const extractionResult = await runExtractionPipeline(
                    file.path,
                    file.originalname
                );

                let fileUrl = "";
                try {
                    const cloudinaryResult = await uploadFileToCloudinary(file.path);
                    fileUrl = cloudinaryResult?.secure_url || "";
                } catch {
                    // Non-critical
                }

                results.push({
                    filename: file.originalname,
                    extraction: {
                        layer: extractionResult.layer,
                        status: extractionResult.status,
                        confidence: extractionResult.confidence,
                        errors: extractionResult.errors,
                    },
                    extractedData: extractionResult.data,
                    fileUrl,
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : "Extraction failed";
                results.push({
                    filename: file.originalname,
                    extraction: {
                        layer: "NONE",
                        status: "FAILED",
                        confidence: 0,
                        errors: [msg],
                    },
                    extractedData: {
                        prNumber: "",
                        supplyType: "",
                        location: "",
                        companyName: "",
                        items: [],
                        rawText: "",
                    },
                    fileUrl: "",
                });
            }
        }

        const successCount = results.filter(r => r.extraction.status !== "FAILED").length;

        res.status(200).json(
            new ApiResponse(
                200,
                { results, summary: { total: files.length, extracted: successCount, failed: files.length - successCount } },
                `Processed ${files.length} files: ${successCount} extracted, ${files.length - successCount} need manual entry`
            )
        );
    }
);

// POST /api/v1/rfp-extract/re-extract/:rfqId
// Re-run extraction on an existing RFQ's source file
export const reExtract = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const file = req.file;
        if (!file) {
            throw new ApiError(400, "RFP file is required for re-extraction");
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (![".doc", ".docx", ".pdf"].includes(ext)) {
            fs.unlinkSync(file.path);
            throw new ApiError(400, "Only .doc, .docx, and .pdf files are supported");
        }

        const extractionResult = await runExtractionPipeline(file.path, file.originalname);

        // Cleanup temp file
        try {
            fs.unlinkSync(file.path);
        } catch {
            // Non-critical
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    extraction: {
                        layer: extractionResult.layer,
                        status: extractionResult.status,
                        confidence: extractionResult.confidence,
                        errors: extractionResult.errors,
                    },
                    extractedData: extractionResult.data,
                    rawText: extractionResult.data.rawText,
                },
                extractionResult.success
                    ? `Re-extraction via ${extractionResult.layer} layer (${extractionResult.status})`
                    : "Re-extraction failed — manual entry required"
            )
        );
    }
);
