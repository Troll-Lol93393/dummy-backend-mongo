import { Router } from "express";
import {
    generateCommercialOffer,
    submitCommercialOffer,
    reviewCommercialOffer,
    resolveCommercialChangeRequest,
    getCommercialOfferHistory,
    getCommercialOffer,
    downloadCommercialOfferPdf,
    downloadCommercialOfferExcel,
} from "../controller/commercialOffer.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

export const commercialOfferRoutes = Router();

commercialOfferRoutes.use(verifyJWT);

// Version management
commercialOfferRoutes.post("/:rfqId/generate", generateCommercialOffer);
commercialOfferRoutes.get("/:rfqId/history", getCommercialOfferHistory);
commercialOfferRoutes.get("/offer/:offerId", getCommercialOffer);

// Status transitions
commercialOfferRoutes.patch("/offer/:offerId/submit", submitCommercialOffer);
commercialOfferRoutes.patch("/offer/:offerId/review", reviewCommercialOffer);
commercialOfferRoutes.patch(
    "/offer/:offerId/change-request/:changeRequestId/resolve",
    resolveCommercialChangeRequest
);

// Download (supports ?offerId= query param for versioned downloads)
commercialOfferRoutes.get("/:rfqId/pdf", downloadCommercialOfferPdf);
commercialOfferRoutes.get("/:rfqId/excel", downloadCommercialOfferExcel);
