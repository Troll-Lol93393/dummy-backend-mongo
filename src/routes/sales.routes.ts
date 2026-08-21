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
    getBarcodeStatus,
    setInvoiceBarcode,
    downloadBarcodeImportTemplate,
    importBarcodes,
    setInvoiceTransportDetails,
} from "../controller/sales.controller";

const router = Router();

router.use(verifyJWT);

// Specific routes must come before the generic "/:id" catch-all below.
router.get("/", getAllSales);
router.get("/stats", getSalesStats);
router.get("/po-fulfillment", getPoFulfillment);
router.get("/financial-years", getFinancialYears);
router.get("/invoices", getInvoices);
router.get("/invoices/:id", getInvoiceDetail);
router.get("/by-po", getPoDispatchList);
router.get("/by-po/:poNumber", getPoDispatchDetail);
// Invoice-level barcode management — "/barcodes" (literal) must be registered
// before the "/:id" catch-all below, or GET /barcodes would be swallowed by it.
router.get(
    "/barcodes/template",
    verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"),
    downloadBarcodeImportTemplate
);
router.get("/barcodes", getBarcodeStatus);
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
router.post(
    "/barcodes/import",
    verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"),
    upload.single("file"),
    importBarcodes
);
// "/barcodes/:invoiceNumber" (literal first segment) is registered before
// "/:id/transport-details" (param first segment) — more literal segments first.
router.patch("/barcodes/:invoiceNumber", verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"), setInvoiceBarcode);
router.patch(
    "/invoices/:id/transport-details",
    verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"),
    setInvoiceTransportDetails
);
router.patch("/:id/transport-details", verifyRoles("ROLE_OWNER", "ROLE_ADMIN", "ROLE_OFFICE_STAFF"), updateSalesTransportDetails);
router.delete("/:id", verifyRoles("ROLE_OWNER", "ROLE_ADMIN"), deleteSales);

export default router;
