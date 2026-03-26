import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL" | "DEBUG";

const formatTimestamp = (): string => new Date().toISOString();

const formatMessage = (level: LogLevel, category: string, message: string, meta?: object): string => {
    const base = `[${formatTimestamp()}] [${level}] [${category}] ${message}`;
    if (meta && Object.keys(meta).length > 0) {
        return `${base} | ${JSON.stringify(meta)}`;
    }
    return base;
};

const writeToFile = (filename: string, content: string): void => {
    const filePath = path.join(LOG_DIR, filename);
    fs.appendFileSync(filePath, content + "\n");
};

const getLogFilename = (): string => {
    const date = new Date().toISOString().split("T")[0];
    return `app-${date}.log`;
};

const getErrorLogFilename = (): string => {
    const date = new Date().toISOString().split("T")[0];
    return `error-${date}.log`;
};

export const logger = {
    info(category: string, message: string, meta?: object): void {
        const formatted = formatMessage("INFO", category, message, meta);
        console.log(formatted);
        writeToFile(getLogFilename(), formatted);
    },

    warn(category: string, message: string, meta?: object): void {
        const formatted = formatMessage("WARN", category, message, meta);
        console.warn(formatted);
        writeToFile(getLogFilename(), formatted);
    },

    error(category: string, message: string, meta?: object): void {
        const formatted = formatMessage("ERROR", category, message, meta);
        console.error(formatted);
        writeToFile(getLogFilename(), formatted);
        writeToFile(getErrorLogFilename(), formatted);
    },

    critical(category: string, message: string, meta?: object): void {
        const formatted = formatMessage("CRITICAL", category, message, meta);
        console.error(formatted);
        writeToFile(getLogFilename(), formatted);
        writeToFile(getErrorLogFilename(), formatted);
        writeToFile("critical.log", formatted);
    },

    debug(category: string, message: string, meta?: object): void {
        if (process.env.NODE_ENV === "development") {
            const formatted = formatMessage("DEBUG", category, message, meta);
            console.debug(formatted);
            writeToFile(getLogFilename(), formatted);
        }
    },
};
