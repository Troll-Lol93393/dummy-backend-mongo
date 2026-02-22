import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware";
import { createRfqItems, getAllRfqItems } from "../controller/rfqItem.controller";

const router = Router();

// Item CRUD routes
router.post("/", verifyJWT, createRfqItems);
router.get("/all", verifyJWT, getAllRfqItems);

export { router as rfqItemRoutes };
