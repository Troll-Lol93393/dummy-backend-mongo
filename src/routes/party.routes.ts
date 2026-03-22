import { Router } from "express";
import {
    createParty,
    getAllParties,
    getParty,
    updateParty,
    deleteParty,
    importPartiesFromExcel,
} from "../controller/party.controller";
import { verifyJWT } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/multer.middleware";

const router = Router();

router.use(verifyJWT);

// Party CRUD routes
router.post("/", verifyJWT, createParty);
router.get("/all", verifyJWT, getAllParties);
router.get("/:partyId", verifyJWT, getParty);
router.put("/:partyId", verifyJWT, updateParty);
router.delete("/:partyId", verifyJWT, deleteParty);
router.post(
    "/import-excel",
    verifyJWT,
    upload.single("file"),
    importPartiesFromExcel
);

export { router as partyRoutes };
