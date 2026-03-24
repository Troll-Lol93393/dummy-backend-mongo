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
    createHardnessType,
    getAllHardnessTypes,
    updateHardnessType,
    deleteHardnessType,
    createHardnessMeasurement,
    getAllHardnessMeasurements,
    updateHardnessMeasurement,
    deleteHardnessMeasurement,
} from "../controller/master.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyJWT);

// Raw Material Type CRUD routes
router.post("/raw-material-type", verifyJWT, createRawMaterialType);
router.get("/raw-material-type/all", verifyJWT, getAllRawMaterialTypes);
router.get("/raw-material-types", verifyJWT, getAllRawMaterialTypes);
router.put("/raw-material-type/:id", verifyJWT, updateRawMaterialType);
router.delete("/raw-material-type/:id", verifyJWT, deleteRawMaterialType);

// Labour Process Type CRUD routes
router.post("/labour-process-type", verifyJWT, createLabourProcessType);
router.get("/labour-process-type/all", verifyJWT, getAllLabourProcessTypes);
router.get("/labour-process-types", verifyJWT, getAllLabourProcessTypes);
router.put("/labour-process-type/:id", verifyJWT, updateLabourProcessType);
router.delete("/labour-process-type/:id", verifyJWT, deleteLabourProcessType);

// Hardness Type CRUD routes
router.post("/hardness-type", verifyJWT, createHardnessType);
router.get("/hardness-type/all", verifyJWT, getAllHardnessTypes);
router.get("/hardness-types", verifyJWT, getAllHardnessTypes);
router.put("/hardness-type/:id", verifyJWT, updateHardnessType);
router.delete("/hardness-type/:id", verifyJWT, deleteHardnessType);

// Hardness Measurement CRUD routes
router.post("/hardness-measurement", verifyJWT, createHardnessMeasurement);
router.get("/hardness-measurement/all", verifyJWT, getAllHardnessMeasurements);
router.get("/hardness-measurements", verifyJWT, getAllHardnessMeasurements);
router.put("/hardness-measurement/:id", verifyJWT, updateHardnessMeasurement);
router.delete("/hardness-measurement/:id", verifyJWT, deleteHardnessMeasurement);

export { router as masterRoutes };
