import { Router } from "express";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";
import {
    getAllEmails,
    getUnreadCount,
    getEmailStats,
    getEmailById,
    triggerSync,
    reclassifyEmail,
    markAsRead,
    markAllRead,
    archiveEmail,
    linkToRfq,
    unlinkEmail,
    createRfqFromEmail,
    downloadAribaDoc,
    downloadAllAribaDocs,
    downloadAndExtractFromEmail,
    getSettings,
    updateSettings,
    testConnection,
    reExtractAriba,
    sendReplyToEmail,
    generateDispatchDraft,
} from "../controller/email.controller";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// List & stats
router.get("/all", getAllEmails);
router.get("/unread-count", getUnreadCount);
router.get("/stats", getEmailStats);

// Settings
router.get("/settings", getSettings);
router.put("/settings", updateSettings);
router.post("/settings/test-connection", testConnection);

// Sync
router.post("/sync", triggerSync);

// Bulk actions
router.patch("/read-all", markAllRead);
router.post("/re-extract-ariba", reExtractAriba);

// Single email operations (must be after /settings, /sync, etc.)
router.get("/:emailId", getEmailById);
router.post("/:emailId/classify", reclassifyEmail);
router.patch("/:emailId/read", markAsRead);
router.patch("/:emailId/archive", archiveEmail);
router.patch("/:emailId/link-rfq", linkToRfq);
router.patch("/:emailId/unlink", unlinkEmail);
router.post("/:emailId/create-rfq", createRfqFromEmail);
router.post("/:emailId/download-and-extract", downloadAndExtractFromEmail);
router.post("/:emailId/download-ariba/:linkIndex", downloadAribaDoc);
router.post("/:emailId/download-all-ariba", downloadAllAribaDocs);
router.post("/:emailId/reply", sendReplyToEmail);
router.get("/:emailId/dispatch-draft", generateDispatchDraft);

export const emailRoutes = router;
