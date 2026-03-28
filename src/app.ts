import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { ApiError } from "./utils/apiError";
import { auditLogMiddleware } from "./middlewares/auditLog.middleware";
import { logger } from "./utils/logger";
import { AuditLog } from "./models/auditLog.model";

const app: Application = express();
app.use(
    cors({
        origin: [
            "https://hoppscotch.io",
            "https://app.hoppscotch.io",
            "http://localhost:3000",
            "http://localhost:3001",
            "https://sheth-engg-frontend-dev.vercel.app",
        ],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        exposedHeaders: ["Content-Disposition"],
        credentials: true,
    })
);

app.options("*", cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Audit log middleware — captures all API requests
app.use(auditLogMiddleware);

// import routes
import { userRoutes } from "./routes/user.routes";
import { rfqRoutes } from "./routes/rfq.routes";
import { itemRoutes } from "./routes/item.routes";
import { rfqItemRoutes } from "./routes/rfqItem.route";
import { rfpExtractionRoutes } from "./routes/rfpExtraction.routes";
import { masterRoutes } from "./routes/master.routes";
import { partyRoutes } from "./routes/party.routes";
import { costingRoutes } from "./routes/costing.routes";
import { technicalOfferRoutes } from "./routes/technicalOffer.routes";
import { commercialOfferRoutes } from "./routes/commercialOffer.routes";
import { rateHistoryRoutes } from "./routes/rateHistory.routes";
import poRegisterRoutes from "./routes/poRegister.routes";
import clientRoutes from "./routes/client.routes";
import itemHistoryRoutes from "./routes/itemHistory.routes";
import companyProfileRoutes from "./routes/companyProfile.routes";
import { staffRoutes } from "./routes/staff.routes";
import { notificationRoutes } from "./routes/notification.routes";
import { auditLogRoutes } from "./routes/auditLog.routes";
import { emailRoutes } from "./routes/email.routes";

app.use("/api/v1/user", userRoutes);
app.use("/api/v1/rfq", rfqRoutes);
app.use("/api/v1/item", itemRoutes);
app.use("/api/v1/rfqItem", rfqItemRoutes);
app.use("/api/v1/rfp-extract", rfpExtractionRoutes);
app.use("/api/v1/master", masterRoutes);
app.use("/api/v1/party", partyRoutes);
app.use("/api/v1/costing", costingRoutes);
app.use("/api/v1/technical-offer", technicalOfferRoutes);
app.use("/api/v1/commercial-offer", commercialOfferRoutes);
app.use("/api/v1/rate-history", rateHistoryRoutes);
app.use("/api/v1/po-register", poRegisterRoutes);
app.use("/api/v1/client", clientRoutes);
app.use("/api/v1/item-history", itemHistoryRoutes);
app.use("/api/v1/company-profile", companyProfileRoutes);
app.use("/api/v1/staff", staffRoutes);
app.use("/api/v1/notification", notificationRoutes);
app.use("/api/v1/audit-logs", auditLogRoutes);
app.use("/api/v1/email", emailRoutes);

// Health check endpoint — designed for UptimeRobot (every 5 minutes)
// Returns detailed system health for monitoring and keeps Render active
app.get("/api/health", (req: Request, res: Response) => {
    const memUsage = process.memoryUsage();
    const dbState = mongoose.connection.readyState;
    const dbStateMap: Record<number, string> = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
    };

    const isHealthy = dbState === 1;

    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? "OK" : "DEGRADED",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        version: "1.0.0",
        database: {
            status: dbStateMap[dbState] || "unknown",
            host: mongoose.connection.host || "N/A",
        },
        memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        },
        pid: process.pid,
    });
});

// Legacy health endpoint (backward compat)
app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({
        status: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
    });
});

// Root endpoint
app.get("/", (req: Request, res: Response) => {
    res.status(200).json({
        message: "Dummy Backend API is running",
        version: "1.0.0",
    });
});

// Global error handler with logging
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    // Log all errors to file
    logger.error("HTTP", `${req.method} ${req.originalUrl} failed`, {
        error: err.message,
        stack: err.stack?.substring(0, 500),
        statusCode: err.statusCode || 500,
        user: req.user?.userName || "Anonymous",
    });

    // Save critical errors to audit log
    AuditLog.create({
        action: "SYSTEM_ERROR",
        method: req.method,
        url: req.originalUrl,
        statusCode: err.statusCode || 500,
        user: req.user?._id || null,
        userName: req.user?.userName || "Anonymous",
        userRole: req.user?.role || "SYSTEM",
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        requestBody: {},
        responseMessage: err.message,
        duration: 0,
        level: err.statusCode >= 500 ? "critical" : "error",
        category: "SYSTEM",
        details: `Error: ${err.message}`,
        errorStack: err.stack?.substring(0, 2000) || "",
    }).catch(() => {});

    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errors: err.errors || [],
        });
    }
    console.error("Unhandled error:", err);
    return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        errors: [err.message || "Unknown error"],
    });
});

export { app };
