import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import dbConnect from "./config/dbConnect";
import { seedDefaultAdmin } from "./config/seedAdmin";
import { app } from "./app";
import { startRfqScheduler } from "./cron/rfqScheduler";
import { startEmailScheduler } from "./cron/emailScheduler";
import { logger } from "./utils/logger";
import { AuditLog } from "./models/auditLog.model";

// Process-level error handlers for crash diagnostics
process.on("uncaughtException", (error: Error) => {
    logger.critical("PROCESS", `Uncaught Exception: ${error.message}`, {
        stack: error.stack?.substring(0, 2000) || "",
        name: error.name,
    });

    // Try to save to DB before exit
    AuditLog.create({
        action: "SYSTEM_CRASH",
        method: "SYSTEM",
        url: "process/uncaughtException",
        statusCode: 500,
        userName: "SYSTEM",
        userRole: "SYSTEM",
        level: "critical",
        category: "SYSTEM",
        details: `Uncaught Exception: ${error.message}`,
        errorStack: error.stack?.substring(0, 2000) || "",
        responseMessage: error.message,
        duration: 0,
    })
        .catch(() => {})
        .finally(() => {
            process.exit(1);
        });
});

process.on("unhandledRejection", (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack?.substring(0, 2000) : "";

    logger.critical("PROCESS", `Unhandled Rejection: ${message}`, { stack: stack || "" });

    AuditLog.create({
        action: "UNHANDLED_REJECTION",
        method: "SYSTEM",
        url: "process/unhandledRejection",
        statusCode: 500,
        userName: "SYSTEM",
        userRole: "SYSTEM",
        level: "critical",
        category: "SYSTEM",
        details: `Unhandled Rejection: ${message}`,
        errorStack: stack || "",
        responseMessage: message,
        duration: 0,
    }).catch(() => {});
});

process.on("SIGTERM", () => {
    logger.warn("PROCESS", "SIGTERM received — shutting down gracefully");
    AuditLog.create({
        action: "SYSTEM_SHUTDOWN",
        method: "SYSTEM",
        url: "process/SIGTERM",
        statusCode: 0,
        userName: "SYSTEM",
        userRole: "SYSTEM",
        level: "warn",
        category: "SYSTEM",
        details: "Server received SIGTERM signal — shutting down",
        responseMessage: "Graceful shutdown initiated",
        duration: 0,
    })
        .catch(() => {})
        .finally(() => {
            process.exit(0);
        });
});

process.on("SIGINT", () => {
    logger.warn("PROCESS", "SIGINT received — shutting down");
    process.exit(0);
});

// Start server
dbConnect()
    .then(async () => {
        const port = process.env.PORT || 8081;
        app.listen(port, () => {
            logger.info("SERVER", `Server is running on port ${port}`, {
                environment: process.env.NODE_ENV || "development",
                pid: process.pid,
            });

            // Log server start as audit event
            AuditLog.create({
                action: "SYSTEM_START",
                method: "SYSTEM",
                url: "process/start",
                statusCode: 200,
                userName: "SYSTEM",
                userRole: "SYSTEM",
                level: "info",
                category: "SYSTEM",
                details: `Server started on port ${port}`,
                responseMessage: "Server started successfully",
                duration: 0,
            }).catch(() => {});
        });

        // Seed default admin & start cron jobs after DB is connected
        await seedDefaultAdmin();
        startRfqScheduler();
        startEmailScheduler();
    })
    .catch(err => {
        logger.critical("DATABASE", "MongoDB connection failed", {
            error: String(err),
        });

        AuditLog.create({
            action: "DATABASE_FAILURE",
            method: "SYSTEM",
            url: "process/dbConnect",
            statusCode: 500,
            userName: "SYSTEM",
            userRole: "SYSTEM",
            level: "critical",
            category: "SYSTEM",
            details: `MongoDB connection failed: ${String(err)}`,
            errorStack: err?.stack?.substring(0, 2000) || "",
            responseMessage: "Database connection failure",
            duration: 0,
        }).catch(() => {});
    });
