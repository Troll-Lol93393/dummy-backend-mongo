import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware";
import {
    getPaymentAdvices,
    getPaymentAdviceById,
    getPaymentAging,
    resolvePaymentAdviceRow,
} from "../controller/payment.controller";

const router = Router();

router.use(verifyJWT);

// Specific routes must come before the generic "/advices/:id" below.
router.get("/advices", getPaymentAdvices);
router.get("/aging", getPaymentAging);
router.get("/advices/:id", getPaymentAdviceById);
router.patch("/advices/:id/resolve", resolvePaymentAdviceRow);

export const paymentRoutes = router;
