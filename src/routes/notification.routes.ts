import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware";
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} from "../controller/notification.controller";

const router = Router();

router.get("/all", verifyJWT, getNotifications);
router.get("/unread-count", verifyJWT, getUnreadCount);
router.patch("/read-all", verifyJWT, markAllAsRead);
router.patch("/:notificationId/read", verifyJWT, markAsRead);

export { router as notificationRoutes };
