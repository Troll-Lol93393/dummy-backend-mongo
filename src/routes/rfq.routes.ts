import { Router } from "express";
import {
    createRFQ,
    getRFQs,
    getRFQ,
    updateRFQ,
    deleteRFQ,
    markAsQuoted,
    markAsRegret,
    getLinkedEmail,
    backfillDocumentUrls,
    syncDrawings,
} from "../controller/rfq.controller";
import { getPendingSummary, markReviewed } from "../controller/pendingRfq.controller";
import { upload } from "../middlewares/multer.middleware";
import { verifyJWT } from "../middlewares/auth.middleware";

export const rfqRoutes = Router();

// All RFQ routes require authentication
rfqRoutes.use(verifyJWT);

// Pending RFQ routes (before /:rfqId to avoid param conflicts)
rfqRoutes.get("/pending-summary", verifyJWT, getPendingSummary);
rfqRoutes.patch("/:rfqId/mark-reviewed", verifyJWT, markReviewed);
rfqRoutes.post("/backfill-document-urls", verifyJWT, backfillDocumentUrls);

// Public authenticated routes
rfqRoutes.get("/all", verifyJWT, getRFQs);
rfqRoutes.get("/:rfqId", verifyJWT, getRFQ);
rfqRoutes.get("/:rfqId/linked-email", verifyJWT, getLinkedEmail);
rfqRoutes.post("/:rfqId/sync-drawings", verifyJWT, syncDrawings);

// User can create RFQs
rfqRoutes.post("/", verifyJWT, createRFQ);

// Create RFQ with file upload
rfqRoutes.post("/uploadFile", verifyJWT,
    upload.single("file"), ((req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        return res.json({
            message: "File uploaded successfully",
            file: req.file,
        });
    })
);

// User can update/delete their own RFQs
rfqRoutes.put("/:rfqId", verifyJWT, updateRFQ);
rfqRoutes.patch("/:rfqId/mark-quoted", verifyJWT, markAsQuoted);
rfqRoutes.patch("/:rfqId/mark-regret", verifyJWT, markAsRegret);
rfqRoutes.delete("/:rfqId", verifyJWT, deleteRFQ);
