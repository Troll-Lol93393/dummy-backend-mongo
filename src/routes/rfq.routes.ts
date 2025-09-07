import { Router } from "express";
import {
    createRFQ,
    getRFQs,
    getRFQ,
    deleteRFQ,
} from "../controller/rfq.controller";
// import { verifyJWT } from "../middlewares/auth.middleware";

export const rfqRoutes = Router();

// All RFQ routes require authentication
// rfqRoutes.use(verifyJWT);

// Public authenticated routes
rfqRoutes.get("/all", getRFQs);
rfqRoutes.get("/:rfqId", getRFQ);

// User can create RFQs
rfqRoutes.post("/", createRFQ);

// User can update/delete their own RFQs
rfqRoutes.delete("/:rfqId", deleteRFQ);
