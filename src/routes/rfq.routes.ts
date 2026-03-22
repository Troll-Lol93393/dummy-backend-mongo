import { Router } from "express";
import {
    createRFQ,
    getRFQs,
    getRFQ,
    updateRFQ,
    deleteRFQ,
} from "../controller/rfq.controller";
import { upload } from "../middlewares/multer.middleware";
import { verifyJWT } from "../middlewares/auth.middleware";

export const rfqRoutes = Router();

// All RFQ routes require authentication
rfqRoutes.use(verifyJWT);

// Public authenticated routes
rfqRoutes.get("/all", verifyJWT, getRFQs);
rfqRoutes.get("/:rfqId", verifyJWT, getRFQ);

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
rfqRoutes.delete("/:rfqId", verifyJWT, deleteRFQ);
