import { Router } from "express";
import { verifySyncApiKey } from "../middlewares/syncApiKey.middleware";
import {
    syncItems,
    syncDeleteItems,
    syncClients,
    syncDeleteClients,
    syncParties,
    syncDeleteParties,
    syncSales,
    syncDeleteSales,
    syncPurchases,
    syncDeletePurchases,
} from "../controller/sync.controller";

const router = Router();

router.use(verifySyncApiKey);

router.post("/items", syncItems);
router.post("/items/delete", syncDeleteItems);
router.post("/clients", syncClients);
router.post("/clients/delete", syncDeleteClients);
router.post("/parties", syncParties);
router.post("/parties/delete", syncDeleteParties);
router.post("/sales", syncSales);
router.post("/sales/delete", syncDeleteSales);
router.post("/purchases", syncPurchases);
router.post("/purchases/delete", syncDeletePurchases);

export const syncRoutes = router;
