import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ApiError } from "./utils/apiError";

const app: Application = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
}));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());

// import routes
import { userRoutes } from "./routes/user.routes";

app.use("/api/v1", userRoutes);


app.get("/", (req: Request, res: Response, next: NextFunction) => {
    res.send("The server is running");
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