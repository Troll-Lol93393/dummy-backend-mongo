import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware";
import { createRfqItems, getAllRfqItems, updateRfqItem, markRfqItemRegret } from "../controller/rfqItem.controller";
import { uploadItemDrawing, bulkUploadDrawings } from "../controller/rfqItemDrawing.controller";
import { upload } from "../middlewares/multer.middleware";

const router = Router();

// Item CRUD routes
router.post("/", verifyJWT, createRfqItems);
router.get("/all", verifyJWT, getAllRfqItems);
router.put("/:rfqItemId", verifyJWT, updateRfqItem);
router.patch("/:rfqItemId/regret", verifyJWT, markRfqItemRegret);

// Drawing upload routes
router.put("/:rfqItemId/drawing", verifyJWT, upload.single("drawing"), uploadItemDrawing);
router.post("/bulk-drawing/:rfqId", verifyJWT, upload.single("zipFile"), bulkUploadDrawings);

export { router as rfqItemRoutes };
