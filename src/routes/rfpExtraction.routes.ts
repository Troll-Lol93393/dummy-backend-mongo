import { Router } from "express";
import { upload } from "../middlewares/multer.middleware";
import { verifyJWT } from "../middlewares/auth.middleware";
import {
    uploadAndExtract,
    confirmAndSave,
    bulkUploadAndExtract,
    reExtract,
    reExtractFromUrl,
    extractSingleItem,
    extractSingleItemFromUrl,
    discoverDrawings,
    applyExtractionToRfq,
    addItemToRfq,
} from "../controller/rfpExtraction.controller";

const rfpExtractionRoutes = Router();

// Single file upload + extraction (Layer 1 → 2 → 3 fallback)
rfpExtractionRoutes.post(
    "/upload",
    verifyJWT,
    upload.single("rfpFile"),
    uploadAndExtract
);

// Bulk file upload + extraction
rfpExtractionRoutes.post(
    "/bulk-upload",
    verifyJWT,
    upload.array("rfpFiles", 20),
    bulkUploadAndExtract
);

// Confirm extracted data and save to DB (creates Item + RFQ + RFQItems)
rfpExtractionRoutes.post(
    "/confirm",
    verifyJWT,
    confirmAndSave
);

// Re-extract from a file (retry extraction without saving)
rfpExtractionRoutes.post(
    "/re-extract",
    verifyJWT,
    upload.single("rfpFile"),
    reExtract
);

// Re-extract from a stored Cloudinary URL (no file upload needed)
rfpExtractionRoutes.post(
    "/re-extract-url",
    verifyJWT,
    reExtractFromUrl
);

// Single item extraction — upload file + serialNumber, get one item back (token-efficient)
rfpExtractionRoutes.post(
    "/single-item",
    verifyJWT,
    upload.single("rfpFile"),
    extractSingleItem
);

// Single item extraction from stored URL (no upload)
rfpExtractionRoutes.post(
    "/single-item-url",
    verifyJWT,
    extractSingleItemFromUrl
);

// Add a single item to an existing RFQ (append, not replace)
rfpExtractionRoutes.post(
    "/add-item/:rfqId",
    verifyJWT,
    addItemToRfq
);

// Apply extracted items to an existing RFQ (replaces current items)
rfpExtractionRoutes.post(
    "/apply/:rfqId",
    verifyJWT,
    applyExtractionToRfq
);

// Discovery: screenshot Ariba page, find attachment links, attempt drawing downloads
rfpExtractionRoutes.post(
    "/discover-drawings",
    verifyJWT,
    discoverDrawings
);

export { rfpExtractionRoutes };
