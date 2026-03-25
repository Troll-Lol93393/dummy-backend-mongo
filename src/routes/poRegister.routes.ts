import { Router } from "express";
import { upload } from "../middlewares/multer.middleware";
import {
    getAllPORegisters,
    getPORegisterById,
    importPORegisters,
    deletePORegister,
    getPOStats,
} from "../controller/poRegister.controller";

const router = Router();

router.get("/", getAllPORegisters);
router.get("/stats", getPOStats);
router.get("/:id", getPORegisterById);
router.post("/import", upload.single("file"), importPORegisters);
router.delete("/:id", deletePORegister);

export default router;
