import { Router } from "express";
import {
    createOrUpdateCosting,
    getCosting,
    getCostingsByRfq,
    deleteCosting,
    cloneCosting,
    searchCostingsForClone,
    downloadCostingSheetPdf,
    downloadCostingSheetExcel,
    uploadProofDocument,
} from "../controller/costing.controller";
import { verifyJWT } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/multer.middleware";

const router = Router();
router.use(verifyJWT);

router.post("/proof-document", upload.single("proofDocument"), uploadProofDocument);
router.get("/search/clone", searchCostingsForClone);
router.get("/rfq/:rfqId/sheet/pdf", downloadCostingSheetPdf);
router.get("/rfq/:rfqId/sheet/excel", downloadCostingSheetExcel);
router.post("/:rfqItemId/clone", cloneCosting);
router.post("/:rfqItemId", createOrUpdateCosting);
router.get("/rfq/:rfqId", getCostingsByRfq);
router.get("/:rfqItemId", getCosting);
router.delete("/:rfqItemId", deleteCosting);

export { router as costingRoutes };
