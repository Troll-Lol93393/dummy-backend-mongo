import mongoose, { Schema, Document } from "mongoose";

export interface IAuditLog extends Document {
    action: string;
    method: string;
    url: string;
    statusCode: number;
    user: mongoose.Types.ObjectId | null;
    userName: string;
    userRole: string;
    ipAddress: string;
    userAgent: string;
    requestBody: Record<string, unknown>;
    responseMessage: string;
    duration: number;
    level: "info" | "warn" | "error" | "critical";
    category: "AUTH" | "RFQ" | "ITEM" | "MASTER" | "PARTY" | "COSTING" | "OFFER" | "PO" | "CLIENT" | "STAFF" | "SYSTEM" | "HEALTH" | "EXTRACTION" | "NOTIFICATION" | "COMPANY" | "OTHER";
    details: string;
    errorStack: string;
    createdAt: Date;
    updatedAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
    {
        action: { type: String, required: true, index: true },
        method: { type: String, required: true },
        url: { type: String, required: true },
        statusCode: { type: Number, required: true, index: true },
        user: { type: Schema.Types.ObjectId, ref: "User", default: null },
        userName: { type: String, default: "Anonymous" },
        userRole: { type: String, default: "SYSTEM" },
        ipAddress: { type: String, default: "" },
        userAgent: { type: String, default: "" },
        requestBody: { type: Schema.Types.Mixed, default: {} },
        responseMessage: { type: String, default: "" },
        duration: { type: Number, default: 0 },
        level: {
            type: String,
            enum: ["info", "warn", "error", "critical"],
            default: "info",
            index: true,
        },
        category: {
            type: String,
            enum: [
                "AUTH", "RFQ", "ITEM", "MASTER", "PARTY", "COSTING", "OFFER",
                "PO", "CLIENT", "STAFF", "SYSTEM", "HEALTH", "EXTRACTION",
                "NOTIFICATION", "COMPANY", "OTHER",
            ],
            default: "OTHER",
            index: true,
        },
        details: { type: String, default: "" },
        errorStack: { type: String, default: "" },
    },
    {
        timestamps: true,
    }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
