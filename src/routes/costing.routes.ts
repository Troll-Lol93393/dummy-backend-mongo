import { Router } from "express";
import {
    createOrUpdateCosting,
    getCosting,
    getCostingsByRfq,
    deleteCosting,
} from "../controller/costing.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();
router.use(verifyJWT);

router.post("/:rfqItemId", createOrUpdateCosting);
router.get("/rfq/:rfqId", getCostingsByRfq);
router.get("/:rfqItemId", getCosting);
router.delete("/:rfqItemId", deleteCosting);

export { router as costingRoutes };
