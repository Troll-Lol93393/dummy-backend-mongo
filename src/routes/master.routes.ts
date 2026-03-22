import { Router } from "express";
import {
    createRawMaterialType,
    getAllRawMaterialTypes,
    updateRawMaterialType,
    deleteRawMaterialType,
    createLabourProcessType,
    getAllLabourProcessTypes,
    updateLabourProcessType,
    deleteLabourProcessType,
} from "../controller/master.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyJWT);

// Raw Material Type CRUD routes
router.post("/raw-material-type", verifyJWT, createRawMaterialType);
router.get("/raw-material-type/all", verifyJWT, getAllRawMaterialTypes);
router.put("/raw-material-type/:id", verifyJWT, updateRawMaterialType);
router.delete("/raw-material-type/:id", verifyJWT, deleteRawMaterialType);

// Labour Process Type CRUD routes
router.post("/labour-process-type", verifyJWT, createLabourProcessType);
router.get("/labour-process-type/all", verifyJWT, getAllLabourProcessTypes);
router.put("/labour-process-type/:id", verifyJWT, updateLabourProcessType);
router.delete("/labour-process-type/:id", verifyJWT, deleteLabourProcessType);

export { router as masterRoutes };
