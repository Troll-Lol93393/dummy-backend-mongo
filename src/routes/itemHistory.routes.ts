import { Router } from "express";
import { getItemHistory } from "../controller/itemHistory.controller";

const router = Router();

router.get("/:itemCode", getItemHistory);

export default router;
