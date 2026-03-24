import { Router } from "express";
import {
    generateTechOffer,
    submitTechOffer,
    reviewTechOffer,
    resolveChangeRequest,
    getTechOfferHistory,
    getTechOffer,
    downloadTechOfferPdf,
    downloadTechOfferExcel,
} from "../controller/technicalOffer.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

export const technicalOfferRoutes = Router();

technicalOfferRoutes.use(verifyJWT);

// Version management
technicalOfferRoutes.post("/:rfqId/generate", generateTechOffer);
technicalOfferRoutes.get("/:rfqId/history", getTechOfferHistory);
technicalOfferRoutes.get("/offer/:offerId", getTechOffer);

// Status transitions
technicalOfferRoutes.patch("/offer/:offerId/submit", submitTechOffer);
technicalOfferRoutes.patch("/offer/:offerId/review", reviewTechOffer);
technicalOfferRoutes.patch("/offer/:offerId/change-request/:changeRequestId/resolve", resolveChangeRequest);

// Download (supports ?offerId= query param for versioned downloads)
technicalOfferRoutes.get("/:rfqId/pdf", downloadTechOfferPdf);
technicalOfferRoutes.get("/:rfqId/excel", downloadTechOfferExcel);
