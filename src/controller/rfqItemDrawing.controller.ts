import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Request, Response, NextFunction } from "express";
import { RFQItems } from "../models/rfqItems.model";
import { RFQ } from "../models/rfq.models";
import { uploadFileToCloudinary } from "../utils/cloudinary";

/**
 * Upload a single PDF drawing for a specific RFQ item.
 * PUT /api/v1/rfqItem/:rfqItemId/drawing
 */
export const uploadItemDrawing = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;

        if (!req.file) {
            throw new ApiError(400, "No file uploaded");
        }

        // Validate PDF only — check extension (mimetype can be unreliable)
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (ext !== ".pdf") {
            fs.unlinkSync(req.file.path);
            throw new ApiError(400, "Only PDF files are allowed");
        }

        const rfqItem = await RFQItems.findOne({ _id: rfqItemId, isDeleted: false });
        if (!rfqItem) {
            fs.unlinkSync(req.file.path);
            throw new ApiError(404, "RFQ Item not found");
        }

        // Normalize path for cloudinary (Windows backslash issue)
        const filePath = req.file.path.replace(/\\/g, "/");
        const cloudinaryResponse = await uploadFileToCloudinary(filePath);
        if (!cloudinaryResponse) {
            throw new ApiError(500, "Failed to upload file to cloud storage");
        }

        // Clean up local file if it still exists
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await RFQItems.findByIdAndUpdate(rfqItemId, {
            $set: { drawingUrl: cloudinaryResponse.secure_url },
        });

        const updatedItem = await RFQItems.findById(rfqItemId).populate([
            "item",
            "itemTechSpecs",
            "commercialSpecs",
        ]);

        res.status(200).json(
            new ApiResponse(200, updatedItem, "Drawing uploaded successfully")
        );
    }
);

/**
 * Bulk upload drawings via a ZIP file.
 * Each PDF inside the ZIP must be named as <itemCode>.pdf
 * POST /api/v1/rfqItem/bulk-drawing/:rfqId
 */
export const bulkUploadDrawings = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        if (!req.file) {
            throw new ApiError(400, "No file uploaded");
        }

        const allowedZipMimes = [
            "application/zip",
            "application/x-zip-compressed",
            "application/x-zip",
            "multipart/x-zip",
        ];

        if (!allowedZipMimes.includes(req.file.mimetype)) {
            fs.unlinkSync(req.file.path);
            throw new ApiError(400, "Only ZIP files are allowed");
        }

        const { rfqId } = req.params;

        // Fetch RFQ with populated items
        const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false }).populate({
            path: "items",
            match: { isDeleted: false },
            populate: [{ path: "item" }],
        });

        if (!rfq) {
            fs.unlinkSync(req.file.path);
            throw new ApiError(404, "RFQ not found");
        }

        const rfqItems = rfq.items as any[];
        if (!rfqItems || rfqItems.length === 0) {
            fs.unlinkSync(req.file.path);
            throw new ApiError(400, "RFQ has no items");
        }

        // Build a map of itemCode -> rfqItem
        const itemCodeMap: Record<string, any> = {};
        for (const rfqItem of rfqItems) {
            if (rfqItem.item && rfqItem.item.itemCode) {
                itemCodeMap[rfqItem.item.itemCode.trim().toUpperCase()] = rfqItem;
            }
        }

        // Extract ZIP
        let zip: AdmZip;
        try {
            zip = new AdmZip(req.file.path);
        } catch {
            fs.unlinkSync(req.file.path);
            throw new ApiError(400, "Invalid or corrupted ZIP file");
        }

        const zipEntries = zip.getEntries();
        const results: {
            success: { itemCode: string; drawingUrl: string }[];
            errors: { fileName: string; reason: string }[];
            skipped: { fileName: string; reason: string }[];
        } = {
            success: [],
            errors: [],
            skipped: [],
        };

        // Filter valid PDF entries (skip directories, __MACOSX, non-PDF)
        const pdfEntries = zipEntries.filter(entry => {
            const name = entry.entryName;
            if (entry.isDirectory) return false;
            if (name.startsWith("__MACOSX") || name.startsWith(".")) return false;
            return true;
        });

        const tempDir = path.join("public", "temp");

        for (const entry of pdfEntries) {
            const fileName = path.basename(entry.entryName);
            const ext = path.extname(fileName).toLowerCase();

            // Only allow PDF
            if (ext !== ".pdf") {
                results.skipped.push({
                    fileName,
                    reason: "Not a PDF file — only .pdf files are allowed",
                });
                continue;
            }

            // Extract item code from filename (remove .pdf extension)
            const itemCode = path.basename(fileName, ".pdf").trim().toUpperCase();

            if (!itemCode) {
                results.errors.push({
                    fileName,
                    reason: "Could not determine item code from filename",
                });
                continue;
            }

            // Match to RFQ item
            const matchedItem = itemCodeMap[itemCode];
            if (!matchedItem) {
                results.errors.push({
                    fileName,
                    reason: `No matching item found with code "${itemCode}"`,
                });
                continue;
            }

            // Write entry to temp file
            const tempFilePath = path.join(
                tempDir,
                `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`
            );

            try {
                fs.writeFileSync(tempFilePath, entry.getData());
            } catch {
                results.errors.push({
                    fileName,
                    reason: "Failed to extract file from ZIP",
                });
                continue;
            }

            // Upload to Cloudinary
            const cloudinaryResponse = await uploadFileToCloudinary(tempFilePath);

            // Clean up temp file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }

            if (!cloudinaryResponse) {
                results.errors.push({
                    fileName,
                    reason: "Failed to upload to cloud storage",
                });
                continue;
            }

            // Update the RFQ item's drawingUrl
            await RFQItems.findByIdAndUpdate(matchedItem._id, {
                $set: { drawingUrl: cloudinaryResponse.secure_url },
            });

            results.success.push({
                itemCode,
                drawingUrl: cloudinaryResponse.secure_url,
            });
        }

        // Clean up the uploaded ZIP file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        const message =
            results.success.length > 0
                ? `${results.success.length} drawing(s) uploaded successfully` +
                  (results.errors.length > 0
                      ? `, ${results.errors.length} failed`
                      : "") +
                  (results.skipped.length > 0
                      ? `, ${results.skipped.length} skipped`
                      : "")
                : "No drawings were uploaded";

        res.status(200).json(new ApiResponse(200, results, message));
    }
);
