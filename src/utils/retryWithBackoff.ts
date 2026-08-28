import axios from "axios";
import { logger } from "./logger";

export interface RetryOptions {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
    maxRetries: 3,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
};

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryOptions>
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            // Extract HTTP status if available
            const status =
                axios.isAxiosError(error) ? error.response?.status : undefined;

            // Non-retryable errors — rethrow immediately
            if (status !== undefined && NON_RETRYABLE_STATUS_CODES.has(status)) {
                throw error;
            }

            // Last attempt exhausted — rethrow
            if (attempt >= opts.maxRetries) {
                throw error;
            }

            // Only retry on retryable status codes or network errors (no response)
            const isRetryable =
                (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) ||
                (axios.isAxiosError(error) && !error.response);

            if (!isRetryable) {
                throw error;
            }

            // Calculate delay: respect Retry-After header on 429, else exponential backoff
            let delayMs = opts.initialDelayMs * Math.pow(2, attempt);

            if (status === 429 && axios.isAxiosError(error)) {
                const retryAfter = error.response?.headers?.["retry-after"];
                if (retryAfter) {
                    const retryAfterMs = Number(retryAfter) * 1000;
                    if (!isNaN(retryAfterMs) && retryAfterMs > 0) {
                        delayMs = retryAfterMs;
                    }
                }
            }

            delayMs = Math.min(delayMs, opts.maxDelayMs);

            const errMsg = error instanceof Error ? error.message : String(error);
            logger.warn(
                "RETRY",
                `Attempt ${attempt + 1}/${opts.maxRetries} failed (status: ${status ?? "N/A"}). Retrying in ${delayMs}ms — ${errMsg}`
            );

            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("retryWithBackoff: exhausted all retries");
}
