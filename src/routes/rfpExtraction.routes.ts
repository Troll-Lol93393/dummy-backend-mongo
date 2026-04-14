import { Router } from "express";
import { upload } from "../middlewares/multer.middleware";
import { verifyJWT } from "../middlewares/auth.middleware";
import {
    uploadAndExtract,
    confirmAndSave,
    bulkUploadAndExtract,
    reExtract,
    discoverDrawings,
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

// Discovery: screenshot Ariba page, find attachment links, attempt drawing downloads
rfpExtractionRoutes.post(
    "/discover-drawings",
    verifyJWT,
    discoverDrawings
);

export { rfpExtractionRoutes };
