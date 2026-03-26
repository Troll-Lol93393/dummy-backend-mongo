import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import { AuditLog } from "../models/auditLog.model";

export const getAuditLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const search = (req.query.search as string) || "";
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

    const level = req.query.level as string;
    const category = req.query.category as string;
    const action = req.query.action as string;
    const userId = req.query.userId as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const filter: Record<string, unknown> = {};

    if (level) filter.level = level;
    if (category) filter.category = category;
    if (action) filter.action = { $regex: action, $options: "i" };
    if (userId) filter.user = userId;

    if (startDate || endDate) {
        const dateFilter: Record<string, Date> = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);
        filter.createdAt = dateFilter;
    }

    if (search) {
        filter.$or = [
            { action: { $regex: search, $options: "i" } },
            { userName: { $regex: search, $options: "i" } },
            { url: { $regex: search, $options: "i" } },
            { responseMessage: { $regex: search, $options: "i" } },
            { details: { $regex: search, $options: "i" } },
        ];
    }

    const skip = (page - 1) * size;

    const [logs, total] = await Promise.all([
        AuditLog.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip(skip)
            .limit(size)
            .lean(),
        AuditLog.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / size);

    res.status(200).json(
        new ApiResponse(200, { data: logs, total, totalPages, page, size }, "Audit logs fetched successfully")
    );
});

export const getAuditLogById = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const log = await AuditLog.findById(id).lean();

    if (!log) {
        throw new ApiError(404, "Audit log not found");
    }

    res.status(200).json(new ApiResponse(200, log, "Audit log fetched successfully"));
});

export const getAuditLogStats = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
        totalLogs,
        last24hCount,
        errorCount24h,
        criticalCount24h,
        byCategory,
        byLevel,
        recentErrors,
        hourlyActivity,
    ] = await Promise.all([
        AuditLog.countDocuments(),
        AuditLog.countDocuments({ createdAt: { $gte: last24h } }),
        AuditLog.countDocuments({ level: "error", createdAt: { $gte: last24h } }),
        AuditLog.countDocuments({ level: "critical", createdAt: { $gte: last24h } }),
        AuditLog.aggregate([
            { $match: { createdAt: { $gte: last7d } } },
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        AuditLog.aggregate([
            { $match: { createdAt: { $gte: last24h } } },
            { $group: { _id: "$level", count: { $sum: 1 } } },
        ]),
        AuditLog.find({ level: { $in: ["error", "critical"] } })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean(),
        AuditLog.aggregate([
            { $match: { createdAt: { $gte: last24h } } },
            {
                $group: {
                    _id: { $hour: "$createdAt" },
                    count: { $sum: 1 },
                    errors: { $sum: { $cond: [{ $in: ["$level", ["error", "critical"]] }, 1, 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ]),
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            totalLogs,
            last24hCount,
            errorCount24h,
            criticalCount24h,
            byCategory,
            byLevel,
            recentErrors,
            hourlyActivity,
        }, "Audit log stats fetched successfully")
    );
});

export const deleteOldAuditLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const daysToKeep = parseInt(req.query.days as string) || 90;
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    const result = await AuditLog.deleteMany({ createdAt: { $lt: cutoff } });

    res.status(200).json(
        new ApiResponse(200, { deletedCount: result.deletedCount, cutoffDate: cutoff }, `Deleted audit logs older than ${daysToKeep} days`)
    );
});
