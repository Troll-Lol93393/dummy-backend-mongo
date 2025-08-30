import { Router } from "express";
import {
  createRFQ,
  getAllRFQs,
  getRFQById,
  updateRFQ,
  deleteRFQ,
  assignRFQ,
  getRFQStats,
} from "../controller/rfq.controller";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";

export const rfqRoutes = Router();

// All RFQ routes require authentication
rfqRoutes.use(verifyJWT);

// Public authenticated routes
rfqRoutes.get("/", getAllRFQs);
rfqRoutes.get("/stats", getRFQStats);
rfqRoutes.get("/:id", getRFQById);

// User can create RFQs
rfqRoutes.post("/", createRFQ);

// User can update/delete their own RFQs
rfqRoutes.patch("/:id", updateRFQ);
rfqRoutes.delete("/:id", deleteRFQ);

// Manager/Admin can assign RFQs
rfqRoutes.patch(
  "/:id/assign",
  verifyRoles("ROLE_ADMIN", "ROLE_MANAGER"),
  assignRFQ
);
