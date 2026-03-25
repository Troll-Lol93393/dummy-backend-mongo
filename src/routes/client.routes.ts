import { Router } from "express";
import {
    getAllClients,
    getClientById,
    createClient,
    updateClient,
    deleteClient,
    importClientsFromExcel,
} from "../controller/client.controller";
import { upload } from "../middlewares/multer.middleware";

const router = Router();

router.get("/", getAllClients);
router.get("/:id", getClientById);
router.post("/", createClient);
router.post("/import-excel", upload.single("file"), importClientsFromExcel);
router.put("/:id", updateClient);
router.delete("/:id", deleteClient);

export default router;
