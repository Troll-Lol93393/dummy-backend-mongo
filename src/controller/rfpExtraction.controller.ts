import { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { runExtractionPipeline, runSingleItemExtractionPipeline, ExtractionResult } from "../services/extraction/extractionOrchestrator";
import { ParsedRfpData, ParsedItem } from "../services/extraction/docParser";
import { Item } from "../models/item.model";
import { RFQ } from "../models/rfq.models";
import { RFQItems } from "../models/rfqItems.model";
import { ItemTechSpecs } from "../models/item.techSpecs.model";
import { CommercialSpecs } from "../models/item.commercial.model";
import { Email } from "../models/email.model";
import { uploadFileToCloudinary } from "../utils/cloudinary";
import { getEmailSettings } from "../models/emailSettings.model";
import { decryptPassword } from "../utils/emailEncryption";
import { discoverAribaDrawings } from "../services/email/aribaScraperService";
import { autoMapRfqDrawingsToItems } from "../services/rfq/drawingMapper.service";

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
            emailId,
            fileUrl,
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
            // Find or create Item in master (search regardless of isDeleted to avoid duplicate key errors)
            let item = await Item.findOne({ itemCode: rawItem.itemCode });

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
            } else if (item.isDeleted) {
                // Restore soft-deleted item with fresh data
                item.isDeleted = false;
                item.itemName = rawItem.itemName || item.itemName;
                item.itemDesc = rawItem.itemDesc || rawItem.itemName || item.itemDesc;
                await item.save();
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
                serialNumber: rawItem.serialNumber || "",
                item: item._id,
                quantity: rawItem.quantity || 1,
                drawingNumber: enrichDrawingNumber(rawItem.drawingNumber || "", rawItem.itemDesc),
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
            documentUrl: fileUrl || undefined,
            items: createdRfqItemIds,
            isQuoted: false,
            isDeleted: false,
            status: "PREVIEW",
            createdBy: req.user?._id?.toString() || "",
            updatedBy: req.user?._id?.toString() || "",
        });

        // Auto-link email to RFQ and carry over any downloaded drawings
        if (emailId) {
            const linkedEmail = await Email.findByIdAndUpdate(emailId, { linkedRfq: rfq._id }, { new: false });
            if (linkedEmail) {
                const aribaWithDrawings = linkedEmail.aribaLinks?.find(l => l.drawings && l.drawings.length > 0);
                if (aribaWithDrawings && aribaWithDrawings.drawings.length > 0) {
                    await rfq.updateOne({
                        drawings: aribaWithDrawings.drawings.map(d => ({ url: d.url, filename: d.filename })),
                    });
                }
            }
        }

        await autoMapRfqDrawingsToItems(rfq._id.toString());

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
                        startDate: "",
                        dueDate: "",
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
                        startDate: "",
                        dueDate: "",
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

// Helper: download a file from a URL to a local temp path (follows redirects)
function downloadFileFromUrl(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const handler = url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(destPath);
        handler
            .get(url, response => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        file.close();
                        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                        downloadFileFromUrl(redirectUrl, destPath).then(resolve, reject);
                        return;
                    }
                }
                response.pipe(file);
                file.on("finish", () => { file.close(); resolve(); });
            })
            .on("error", err => {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                reject(err);
            });
    });
}

// POST /api/v1/rfp-extract/re-extract-url
// Re-run extraction on a document already stored in Cloudinary (no file upload needed)
export const reExtractFromUrl = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { documentUrl, filename } = req.body;
        if (!documentUrl) throw new ApiError(400, "documentUrl is required");

        const originalFilename = filename || path.basename(new URL(documentUrl).pathname) || "document.doc";
        const ext = path.extname(originalFilename).toLowerCase() || ".doc";
        if (![".doc", ".docx", ".pdf"].includes(ext)) {
            throw new ApiError(400, "Only .doc, .docx, and .pdf files are supported");
        }

        const tmpPath = path.join(require("os").tmpdir(), `rfp_reextract_${Date.now()}${ext}`);
        try {
            await downloadFileFromUrl(documentUrl, tmpPath);
        } catch (err) {
            throw new ApiError(500, `Failed to download document: ${err instanceof Error ? err.message : String(err)}`);
        }

        let extractionResult;
        try {
            extractionResult = await runExtractionPipeline(tmpPath, originalFilename);
        } finally {
            try { fs.unlinkSync(tmpPath); } catch { /* non-critical */ }
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

// POST /api/v1/rfp-extract/single-item-url
// Extract a single item from a document already stored in Cloudinary (no file upload)
export const extractSingleItemFromUrl = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { documentUrl, filename, serialNumber } = req.body;
        if (!documentUrl) throw new ApiError(400, "documentUrl is required");
        if (!serialNumber?.trim()) throw new ApiError(400, "serialNumber is required");

        const originalFilename = filename || path.basename(new URL(documentUrl).pathname) || "document.doc";
        const ext = path.extname(originalFilename).toLowerCase() || ".doc";
        const tmpPath = path.join(require("os").tmpdir(), `rfp_single_${Date.now()}${ext}`);
        try {
            await downloadFileFromUrl(documentUrl, tmpPath);
        } catch (err) {
            throw new ApiError(500, `Failed to download document: ${err instanceof Error ? err.message : String(err)}`);
        }

        let result;
        try {
            result = await runSingleItemExtractionPipeline(tmpPath, originalFilename, serialNumber.trim());
        } finally {
            try { fs.unlinkSync(tmpPath); } catch { /* non-critical */ }
        }

        res.status(200).json(
            new ApiResponse(
                200,
                { layer: result.layer, confidence: result.confidence, errors: result.errors, item: result.item },
                result.success ? `Item extracted via ${result.layer} (${result.confidence}%)` : "Extraction failed"
            )
        );
    }
);

// POST /api/v1/rfp-extract/single-item
// Upload a file and extract just ONE item (by serial number) — saves tokens vs full extraction
export const extractSingleItem = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const file = req.file;
        if (!file) throw new ApiError(400, "RFP file is required");

        const ext = path.extname(file.originalname).toLowerCase();
        if (![".doc", ".docx", ".pdf"].includes(ext)) {
            fs.unlinkSync(file.path);
            throw new ApiError(400, "Only .doc, .docx, and .pdf files are supported");
        }

        const { serialNumber } = req.body;
        if (!serialNumber || !serialNumber.trim()) {
            fs.unlinkSync(file.path);
            throw new ApiError(400, "serialNumber is required for single-item extraction");
        }

        const result = await runSingleItemExtractionPipeline(file.path, file.originalname, serialNumber.trim());

        try { fs.unlinkSync(file.path); } catch { /* non-critical */ }

        res.status(200).json(
            new ApiResponse(
                200,
                { layer: result.layer, confidence: result.confidence, errors: result.errors, item: result.item },
                result.success ? `Item extracted via ${result.layer} (confidence ${result.confidence}%)` : "Extraction failed — manual entry required"
            )
        );
    }
);

/**
 * Extracts the position/item number from an item description and appends it to the drawing number.
 *
 * Handles two description formats produced by the extraction pipeline:
 *
 * 1. Full APD format:
 *    "APD,ITEM NAME:HEAT INSULATING CAP;DRAWING NUMBER:JSW-RIG-SP-HIC-M-1014;POSITION OR ITEM NUMBER:2;..."
 *    → matches "POSITION OR ITEM NUMBER:2"
 *
 * 2. Short comma format (AI shorthand):
 *    "HEAT INSLTNG CAP,JSW-RIG-SP-HIC-M-1014,2"
 *    → drawing number appears in desc, trailing number after it is the position
 *
 * Result: "JSW-RIG-SP-HIC-M-1014 (ITEM- 2)"
 */
function enrichDrawingNumber(drawingNumber: string, itemDesc?: string): string {
    if (!drawingNumber || !itemDesc) return drawingNumber;
    // Already has position suffix — don't double-append
    if (/\(ITEM-\s*\d+\)/i.test(drawingNumber)) return drawingNumber;

    // Pattern 1: full APD format — "POSITION OR ITEM NUMBER:N"
    const apdMatch = itemDesc.match(/POSITION\s+OR\s+ITEM\s+NUMBER\s*[:\s]+(\d+)/i);
    if (apdMatch && apdMatch[1]) {
        return `${drawingNumber} (ITEM- ${apdMatch[1]})`;
    }

    // Pattern 2: short comma format — "...,DRAWING_NUMBER,N"
    // Escape the drawing number for use in a regex
    const escaped = drawingNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shortMatch = itemDesc.match(new RegExp(escaped + "\\s*,\\s*(\\d+)", "i"));
    if (shortMatch && shortMatch[1]) {
        return `${drawingNumber} (ITEM- ${shortMatch[1]})`;
    }

    return drawingNumber;
}

// Placeholder values the AI sometimes returns instead of real data
const PLACEHOLDER_VALUES = new Set([
    "item name", "item code", "item description", "item type",
    "string", "n/a", "na", "unknown", "null", "undefined", "none", "tbd",
]);

function isPlaceholder(value: string | undefined): boolean {
    if (!value || !value.trim()) return true;
    return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

// POST /api/v1/rfp-extract/add-item/:rfqId
// Append a single extracted item to an existing RFQ (does NOT replace current items)
export const addItemToRfq = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqId } = req.params;
        const rawItem = req.body as ParsedItem;

        if (!rawItem.itemCode || !rawItem.itemName) {
            throw new ApiError(400, "itemCode and itemName are required");
        }
        if (isPlaceholder(rawItem.itemCode) || isPlaceholder(rawItem.itemName)) {
            throw new ApiError(400, `Extracted item has placeholder values — itemCode: "${rawItem.itemCode}", itemName: "${rawItem.itemName}". Please verify extraction.`);
        }

        const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
        if (!rfq) throw new ApiError(404, "RFQ not found");

        let item = await Item.findOne({ itemCode: rawItem.itemCode });
        if (!item) {
            item = await Item.create({
                itemCode: rawItem.itemCode,
                itemName: rawItem.itemName,
                itemDesc: rawItem.itemDesc || rawItem.itemName,
                itemType: rawItem.itemType || "UNIT",
                size: "",
                isDeleted: false,
            });
        } else if (item.isDeleted) {
            item.isDeleted = false;
            item.itemName = rawItem.itemName || item.itemName;
            item.itemDesc = rawItem.itemDesc || rawItem.itemName || item.itemDesc;
            await item.save();
        }

        const techSpecs = await ItemTechSpecs.create({
            material: rawItem.technical?.material || "",
            diameter: rawItem.technical?.diameter || "",
            length: rawItem.technical?.length || "",
            weight: rawItem.technical?.weight || "",
            grade: rawItem.technical?.grade || "",
        });

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

        const rfqItem = await RFQItems.create({
            serialNumber: rawItem.serialNumber || "",
            item: item._id,
            quantity: rawItem.quantity || 1,
            drawingNumber: rawItem.drawingNumber || "",
            drawingUrl: "",
            itemTechSpecs: techSpecs._id,
            commercialSpecs: commercialSpecs._id,
            isDeleted: false,
        });

        await rfq.updateOne({
            $push: { items: rfqItem._id },
            updatedBy: req.user?._id?.toString() || "",
        });

        res.status(201).json(new ApiResponse(201, rfqItem, "Item added to RFQ successfully"));
    }
);

// POST /api/v1/rfp-extract/apply/:rfqId
// Apply extracted items to an existing RFQ (replaces current items)
export const applyExtractionToRfq = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqId } = req.params;
        const { items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new ApiError(400, "At least one item is required");
        }

        const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false });
        if (!rfq) throw new ApiError(404, "RFQ not found");

        const oldItemIds = (rfq.items as unknown as string[]).map(String);
        const createdRfqItemIds: string[] = [];

        for (const rawItem of items as ParsedItem[]) {
            if (isPlaceholder(rawItem.itemCode) || isPlaceholder(rawItem.itemName)) {
                throw new ApiError(400, `Item has placeholder values — itemCode: "${rawItem.itemCode ?? ""}", itemName: "${rawItem.itemName ?? ""}". Extraction may have failed for this item.`);
            }
            let item = await Item.findOne({ itemCode: rawItem.itemCode });
            if (!item) {
                if (!rawItem.itemCode || !rawItem.itemName) {
                    throw new ApiError(400, `Item code and name are required: ${rawItem.itemCode || "(empty)"}`);
                }
                item = await Item.create({
                    itemCode: rawItem.itemCode,
                    itemName: rawItem.itemName,
                    itemDesc: rawItem.itemDesc || rawItem.itemName,
                    itemType: rawItem.itemType || "UNIT",
                    size: "",
                    isDeleted: false,
                });
            } else if (item.isDeleted) {
                item.isDeleted = false;
                item.itemName = rawItem.itemName || item.itemName;
                item.itemDesc = rawItem.itemDesc || rawItem.itemName || item.itemDesc;
                await item.save();
            }

            const techSpecs = await ItemTechSpecs.create({
                material: rawItem.technical?.material || "",
                diameter: rawItem.technical?.diameter || "",
                length: rawItem.technical?.length || "",
                weight: rawItem.technical?.weight || "",
                grade: rawItem.technical?.grade || "",
            });

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

            const rfqItem = await RFQItems.create({
                serialNumber: rawItem.serialNumber || "",
                item: item._id,
                quantity: rawItem.quantity || 1,
                drawingNumber: enrichDrawingNumber(rawItem.drawingNumber || "", rawItem.itemDesc),
                drawingUrl: "",
                itemTechSpecs: techSpecs._id,
                commercialSpecs: commercialSpecs._id,
                isDeleted: false,
            });

            createdRfqItemIds.push(rfqItem._id.toString());
        }

        await rfq.updateOne({ items: createdRfqItemIds, updatedBy: req.user?._id?.toString() || "" });

        // Soft-delete old items
        if (oldItemIds.length > 0) {
            await RFQItems.updateMany({ _id: { $in: oldItemIds } }, { isDeleted: true });
        }

        const populatedRfq = await RFQ.findById(rfq._id).populate({
            path: "items",
            match: { isDeleted: false },
            populate: [{ path: "item" }, { path: "itemTechSpecs" }, { path: "commercialSpecs" }],
        });

        res.status(200).json(new ApiResponse(200, populatedRfq, "RFQ items updated from extracted data"));
    }
);

// POST /api/v1/rfp-extract/discover-drawings
// Discovery: navigate Ariba RFQ page, screenshot it, find attachment links, attempt downloads
// Use this to identify the correct selectors before wiring into the cron pipeline (Phase 2)
export const discoverDrawings = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { aribaUrl } = req.body;
        if (!aribaUrl) {
            throw new ApiError(400, "aribaUrl is required");
        }

        const settings = await getEmailSettings();
        if (!settings.aribaUsername || !settings.aribaPassword) {
            throw new ApiError(500, "Ariba credentials not configured in Email Settings");
        }

        const aribaPassword = decryptPassword(settings.aribaPassword);

        const result = await discoverAribaDrawings(
            aribaUrl,
            settings.aribaUsername,
            aribaPassword
        );

        // Upload screenshot to Cloudinary
        let screenshotUrl: string | null = null;
        if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
            try {
                const cloudResult = await uploadFileToCloudinary(result.screenshotPath);
                screenshotUrl = cloudResult?.secure_url || null;
            } catch {
                // Non-critical — screenshotPath still returned for local reference
            }
            try { fs.unlinkSync(result.screenshotPath); } catch { /* ignore */ }
        }

        // Upload any downloaded drawings to Cloudinary
        const drawings: { url: string; filename: string }[] = [];
        for (const drawing of result.drawings) {
            if (fs.existsSync(drawing.filePath)) {
                try {
                    const cloudResult = await uploadFileToCloudinary(drawing.filePath);
                    if (cloudResult?.secure_url) {
                        drawings.push({ url: cloudResult.secure_url, filename: drawing.filename });
                    }
                } catch {
                    // Non-critical
                }
            }
        }

        // Cleanup temp download dir
        if (fs.existsSync(result.downloadDir)) {
            fs.rmSync(result.downloadDir, { recursive: true, force: true });
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    screenshotUrl,
                    drawings,
                    candidateLinks: result.candidateLinks,
                },
                `Discovery complete: ${result.candidateLinks.length} candidate link(s) found, ${drawings.length} drawing(s) downloaded`
            )
        );
    }
);
