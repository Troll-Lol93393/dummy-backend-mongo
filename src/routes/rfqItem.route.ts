import { Router } from "express";
import { createRfqItems, getAllRfqItems } from "../controller/rfqItem.controller";

const router = Router();

// Item CRUD routes
router.post("/", createRfqItems);
router.get("/all", getAllRfqItems);

export { router as rfqItemRoutes };
