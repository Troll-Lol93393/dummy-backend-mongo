import { Router } from "express";
import {
    getAllStaff,
    getStaffById,
    createStaff,
    updateStaff,
    deleteStaff,
    resetStaffPassword,
} from "../controller/staff.controller";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";

const router = Router();
router.use(verifyJWT);
router.use(verifyRoles("ROLE_OWNER", "ROLE_ADMIN"));

router.get("/", getAllStaff);
router.get("/:id", getStaffById);
router.post("/", createStaff);
router.put("/:id", updateStaff);
router.delete("/:id", deleteStaff);
router.patch("/:id/reset-password", resetStaffPassword);

export { router as staffRoutes };
