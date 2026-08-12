import { Router } from "express";
import { upload } from "../middlewares/multer.middleware";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";
import {
    getAllSales,
    getSalesById,
    importSales,
    deleteSales,
    getSalesStats,
    getPoFulfillment,
} from "../controller/sales.controller";

const router = Router();

router.use(verifyJWT);

router.get("/", getAllSales);
router.get("/stats", getSalesStats);
router.get("/po-fulfillment", getPoFulfillment);
router.get("/:id", getSalesById);
router.post("/import", verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"), upload.single("file"), importSales);
router.delete("/:id", verifyRoles("ROLE_OWNER", "ROLE_ADMIN"), deleteSales);

export default router;
