import { Router } from "express";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";
import {
    getAuditLogs,
    getAuditLogById,
    getAuditLogStats,
    deleteOldAuditLogs,
} from "../controller/auditLog.controller";

const router = Router();

// All audit log routes require authentication and admin/owner role
router.get("/", verifyJWT, verifyRoles("ROLE_OWNER", "ROLE_ADMIN"), getAuditLogs);
router.get("/stats", verifyJWT, verifyRoles("ROLE_OWNER", "ROLE_ADMIN"), getAuditLogStats);
router.get("/:id", verifyJWT, verifyRoles("ROLE_OWNER", "ROLE_ADMIN"), getAuditLogById);
router.delete("/cleanup", verifyJWT, verifyRoles("ROLE_OWNER"), deleteOldAuditLogs);

export { router as auditLogRoutes };
