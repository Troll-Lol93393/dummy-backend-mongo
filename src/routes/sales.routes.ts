import { Router } from "express";
import { upload } from "../middlewares/multer.middleware";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";
import {
    getAllSales,
    getSalesById,
    importSales,
    deleteSales,
    getSalesStats,
    getPoFulfillment,
    getFinancialYears,
    getInvoices,
    getInvoiceDetail,
    getPoDispatchList,
    getPoDispatchDetail,
    updateSalesTransportDetails,
    downloadTransportDetailsTemplate,
    bulkImportTransportDetails,
} from "../controller/sales.controller";

const router = Router();

router.use(verifyJWT);

// Specific routes must come before the generic "/:id" catch-all below.
router.get("/", getAllSales);
router.get("/stats", getSalesStats);
router.get("/po-fulfillment", getPoFulfillment);
router.get("/financial-years", getFinancialYears);
router.get("/invoices", getInvoices);
router.get("/invoices/:invoiceNumber", getInvoiceDetail);
router.get("/by-po", getPoDispatchList);
router.get("/by-po/:poNumber", getPoDispatchDetail);
router.get("/:id", getSalesById);
router.post("/import", verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"), upload.single("file"), importSales);
router.get(
    "/transport-details/template",
    verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"),
    downloadTransportDetailsTemplate
);
router.post(
    "/transport-details/bulk-import",
    verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"),
    upload.single("file"),
    bulkImportTransportDetails
);
router.patch("/:id/transport-details", verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"), updateSalesTransportDetails);
router.delete("/:id", verifyRoles("ROLE_OWNER", "ROLE_ADMIN"), deleteSales);

export default router;
