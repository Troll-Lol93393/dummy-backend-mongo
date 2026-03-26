import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import { Notification } from "../models/notification.model";

/**
 * GET /api/v1/notification/all
 * Fetch paginated notifications (newest first).
 */
export const getNotifications = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 20;

        const filter: Record<string, unknown> = {};
        if (req.query.isRead === "true") filter.isRead = true;
        if (req.query.isRead === "false") filter.isRead = false;

        const totalCount = await Notification.countDocuments(filter);
        const notifications = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * size)
            .limit(size)
            .populate("rfq", "prNumber companyName status dueDate")
            .lean();

        const unreadCount = await Notification.countDocuments({ isRead: false });

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    data: notifications,
                    unreadCount,
                    totalCount,
                    page,
                    size,
                    totalPages: Math.ceil(totalCount / size),
                },
                "Notifications fetched successfully"
            )
        );
    }
);

/**
 * GET /api/v1/notification/unread-count
 * Quick count of unread notifications (for badge).
 */
export const getUnreadCount = asyncHandler(
    async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
        const count = await Notification.countDocuments({ isRead: false });
        res.status(200).json(new ApiResponse(200, { unreadCount: count }, "Unread count fetched"));
    }
);

/**
 * PATCH /api/v1/notification/:notificationId/read
 * Mark a single notification as read.
 */
export const markAsRead = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        const { notificationId } = req.params;
        const notification = await Notification.findByIdAndUpdate(
            notificationId,
            { isRead: true },
            { new: true }
        );
        if (!notification) {
            throw new ApiError(404, "Notification not found");
        }
        res.status(200).json(new ApiResponse(200, notification, "Notification marked as read"));
    }
);

/**
 * PATCH /api/v1/notification/read-all
 * Mark all notifications as read.
 */
export const markAllAsRead = asyncHandler(
    async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
        await Notification.updateMany({ isRead: false }, { isRead: true });
        res.status(200).json(new ApiResponse(200, null, "All notifications marked as read"));
    }
);
