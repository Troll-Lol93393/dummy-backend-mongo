import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ApiError } from "./utils/apiError";

const app: Application = express();
app.use(
    cors({
        origin: [
            "https://hoppscotch.io",
            "https://app.hoppscotch.io",
            "http://localhost:3000",
            "http://localhost:3004"
        ],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Requested-With"
        ],
        credentials: true
    })
);

app.options("*", cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// import routes
import { userRoutes } from "./routes/user.routes";
import { rfqRoutes } from "./routes/rfq.routes";
import { itemRoutes } from "./routes/item.routes";
import { rfqItemRoutes } from "./routes/rfqItem.route";
import { rfpExtractionRoutes } from "./routes/rfpExtraction.routes";

app.use("/api/v1/user", userRoutes);
app.use("/api/v1/rfq", rfqRoutes);
app.use("/api/v1/item", itemRoutes);
app.use("/api/v1/rfqItem", rfqItemRoutes);
app.use("/api/v1/rfp-extract", rfpExtractionRoutes);

// Health check endpoint
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

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errors: err.errors || [],
        });
    }
    return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        errors: [err.message || "Unknown error"],
    });
});

export { app };
