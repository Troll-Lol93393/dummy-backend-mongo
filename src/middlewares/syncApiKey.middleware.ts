import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";

// Machine-to-machine auth for the legacy sync agent (jow-legacy-sync) - a
// single trusted local process, not a third-party client, so a shared API
// key over HTTPS is proportionate here rather than full OAuth.
export function verifySyncApiKey(req: Request, _res: Response, next: NextFunction): void {
    const expectedKey = process.env.SYNC_API_KEY;
    if (!expectedKey) {
        throw new ApiError(500, "SYNC_API_KEY is not configured on the server");
    }

    const providedKey = req.header("X-Sync-Api-Key");
    if (!providedKey || providedKey !== expectedKey) {
        throw new ApiError(401, "Invalid or missing sync API key");
    }

    next();
}
