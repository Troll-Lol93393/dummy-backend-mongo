import { Request, Response, NextFunction } from "express";
import { AuditLog } from "../models/auditLog.model";
import { logger } from "../utils/logger";

const SENSITIVE_FIELDS = ["password", "refreshToken", "accessToken", "otp", "resetOtp", "resetPasswordToken"];

const sanitizeBody = (body: Record<string, unknown>): Record<string, unknown> => {
    if (!body || typeof body !== "object") return {};
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
        if (SENSITIVE_FIELDS.includes(key)) {
            sanitized[key] = "[REDACTED]";
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
};

const resolveCategory = (url: string): IAuditCategory => {
    if (url.includes("/user/login") || url.includes("/user/register") || url.includes("/user/logout") || url.includes("/user/forgot") || url.includes("/user/reset") || url.includes("/user/verify") || url.includes("/user/refresh")) return "AUTH";
    if (url.includes("/rfq")) return "RFQ";
    if (url.includes("/item-history") || url.includes("/item")) return "ITEM";
    if (url.includes("/master")) return "MASTER";
    if (url.includes("/party")) return "PARTY";
    if (url.includes("/costing")) return "COSTING";
    if (url.includes("/technical-offer") || url.includes("/commercial-offer")) return "OFFER";
    if (url.includes("/po-register")) return "PO";
    if (url.includes("/client")) return "CLIENT";
    if (url.includes("/staff")) return "STAFF";
    if (url.includes("/rfp-extract")) return "EXTRACTION";
    if (url.includes("/notification")) return "NOTIFICATION";
    if (url.includes("/company-profile")) return "COMPANY";
    if (url.includes("/health") || url.includes("/api/health")) return "HEALTH";
    return "OTHER";
};

type IAuditCategory = "AUTH" | "RFQ" | "ITEM" | "MASTER" | "PARTY" | "COSTING" | "OFFER" | "PO" | "CLIENT" | "STAFF" | "SYSTEM" | "HEALTH" | "EXTRACTION" | "NOTIFICATION" | "COMPANY" | "OTHER";

const resolveAction = (method: string, url: string): string => {
    const category = resolveCategory(url);

    if (url.includes("/login")) return "USER_LOGIN";
    if (url.includes("/register")) return "USER_REGISTER";
    if (url.includes("/logout")) return "USER_LOGOUT";
    if (url.includes("/forgot-password")) return "FORGOT_PASSWORD";
    if (url.includes("/reset-password")) return "RESET_PASSWORD";
    if (url.includes("/refresh-token")) return "TOKEN_REFRESH";

    const methodMap: Record<string, string> = {
        GET: "VIEW",
        POST: "CREATE",
        PUT: "UPDATE",
        PATCH: "UPDATE",
        DELETE: "DELETE",
    };

    const actionVerb = methodMap[method.toUpperCase()] || "ACCESS";
    return `${actionVerb}_${category}`;
};

const resolveLevel = (statusCode: number): "info" | "warn" | "error" | "critical" => {
    if (statusCode >= 500) return "critical";
    if (statusCode >= 400) return "error";
    if (statusCode >= 300) return "warn";
    return "info";
};

export const auditLogMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    // Skip health check from flooding logs
    if (req.url === "/health" || req.url === "/api/health") {
        next();
        return;
    }

    const originalJson = res.json.bind(res);
    let responseMessage = "";

    res.json = (body: any) => {
        if (body?.message) {
            responseMessage = body.message;
        }
        return originalJson(body);
    };

    res.on("finish", () => {
        const duration = Date.now() - startTime;
        const action = resolveAction(req.method, req.originalUrl);
        const category = resolveCategory(req.originalUrl);
        const level = resolveLevel(res.statusCode);

        const logEntry = {
            action,
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            user: req.user?._id || null,
            userName: req.user?.userName || req.user?.email || "Anonymous",
            userRole: req.user?.role || "SYSTEM",
            ipAddress: req.ip || req.socket?.remoteAddress || "",
            userAgent: req.headers["user-agent"] || "",
            requestBody: sanitizeBody(req.body),
            responseMessage,
            duration,
            level,
            category,
            details: `${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`,
        };

        // Save to DB asynchronously (fire and forget)
        AuditLog.create(logEntry).catch(err => {
            logger.error("AUDIT", "Failed to save audit log", { error: String(err) });
        });

        // Also log to file
        if (level === "error" || level === "critical") {
            logger.error("AUDIT", logEntry.details, { action, userName: logEntry.userName, statusCode: res.statusCode });
        } else {
            logger.info("AUDIT", logEntry.details, { action, userName: logEntry.userName });
        }
    });

    next();
};
