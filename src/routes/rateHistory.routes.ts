import { Router } from "express";
import {
    getMaterialRateHistory,
    getLabourRateHistory,
    getSupplyRateHistory,
    getVendorComparison,
} from "../controller/rateHistory.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

export const rateHistoryRoutes = Router();

rateHistoryRoutes.use(verifyJWT);

rateHistoryRoutes.get("/material/:partyId", getMaterialRateHistory);
rateHistoryRoutes.get("/labour/:partyId", getLabourRateHistory);
rateHistoryRoutes.get("/supply/:partyId", getSupplyRateHistory);
rateHistoryRoutes.get("/vendor-comparison", getVendorComparison);
