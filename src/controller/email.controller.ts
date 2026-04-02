import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { ApiResponse } from "../utils/apiResponse";
import { Email, EMAIL_CATEGORIES, EmailCategory } from "../models/email.model";
import { getEmailSettings } from "../models/emailSettings.model";
import { encryptPassword } from "../utils/emailEncryption";
import { syncEmails, testImapConnection, reExtractAribaLinks } from "../services/email/imapService";
import { classifyEmail, classifyUnprocessed } from "../services/email/classificationService";
import { downloadSingleAribaDoc, downloadAribaDocSync } from "../services/email/aribaScraperService";
import { decryptPassword } from "../utils/emailEncryption";
import { uploadFileToCloudinary } from "../utils/cloudinary";
import { runExtractionPipeline } from "../services/extraction/extractionOrchestrator";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";

// ─── List emails (paginated + filters) ──────────────────────────────────────

export const getAllEmails = asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size as string) || 20));
    const sortBy = (req.query.sortBy as string) || "date";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    const filter: Record<string, unknown> = { isDeleted: false };

    // Category filter
    if (req.query.category && EMAIL_CATEGORIES.includes(req.query.category as EmailCategory)) {
        filter["classification.category"] = req.query.category;
    }

    // Source filter
    if (req.query.source && ["ARIBA", "DIRECT", "UNKNOWN"].includes(req.query.source as string)) {
        filter.source = req.query.source;
    }

    // Linked/unlinked filter
    if (req.query.linked === "rfq") filter.linkedRfq = { $ne: null };
    else if (req.query.linked === "none") {
        filter.linkedRfq = null;
    }

    // Read/unread filter
    if (req.query.isRead === "true") filter.isRead = true;
    else if (req.query.isRead === "false") filter.isRead = false;

    // Archived filter
    if (req.query.isArchived === "true") filter.isArchived = true;
    else filter.isArchived = false;

    // Period filter (synced with stats bar)
    if (req.query.period === "today") {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        filter.date = { $gte: start };
    } else if (req.query.period === "yesterday") {
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(0, 0, 0, 0);
        filter.date = { $gte: start, $lt: end };
    } else if (req.query.period === "week") {
        // Business week: Sunday 00:00 to Saturday 00:00 (midnight)
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const lastSunday = new Date(now);
        lastSunday.setDate(now.getDate() - day);
        lastSunday.setHours(0, 0, 0, 0);
        filter.date = { $gte: lastSunday };
    } else if (req.query.from || req.query.to) {
        // Custom date range
        const dateFilter: Record<string, Date> = {};
        if (req.query.from) dateFilter.$gte = new Date(req.query.from as string);
        if (req.query.to) dateFilter.$lte = new Date(req.query.to as string);
        filter.date = dateFilter;
    }

    // Search
    if (req.query.search) {
        const search = req.query.search as string;
        filter.$or = [
            { subject: { $regex: search, $options: "i" } },
            { "from.name": { $regex: search, $options: "i" } },
            { "from.address": { $regex: search, $options: "i" } },
            { "classification.extractedData.prNumbers": { $regex: search, $options: "i" } },
            { "classification.extractedData.poNumbers": { $regex: search, $options: "i" } },
            { "classification.extractedData.companyNames": { $regex: search, $options: "i" } },
            { textBody: { $regex: search, $options: "i" } },
        ];
    }

    const [data, totalCount] = await Promise.all([
        Email.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size)
            .populate("linkedRfq", "prNumber companyName status")
            .lean(),
        Email.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / size);

    res.status(200).json(
        new ApiResponse(200, { data, totalPages, totalCount, page, size }, "Emails fetched")
    );
});

// ─── Unread count ────────────────────────────────────────────────────────────

export const getUnreadCount = asyncHandler(async (_req: Request, res: Response) => {
    const count = await Email.countDocuments({
        isRead: false,
        isDeleted: false,
        isArchived: false,
    });
    res.status(200).json(new ApiResponse(200, { unreadCount: count }, "Unread count"));
});

// ─── Stats ───────────────────────────────────────────────────────────────────

export const getEmailStats = asyncHandler(async (req: Request, res: Response) => {
    const period = req.query.period as string;
    const match: Record<string, unknown> = { isDeleted: false };

    if (period === "today") {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        match.date = { $gte: start };
    } else if (period === "yesterday") {
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(0, 0, 0, 0);
        match.date = { $gte: start, $lt: end };
    } else if (period === "week") {
        // Business week: Sunday 00:00 to Saturday 00:00 (midnight)
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const lastSunday = new Date(now);
        lastSunday.setDate(now.getDate() - day);
        lastSunday.setHours(0, 0, 0, 0);
        match.date = { $gte: lastSunday };
    } else if (req.query.from) {
        const dateFilter: Record<string, Date> = {};
        dateFilter.$gte = new Date(req.query.from as string);
        if (req.query.to) dateFilter.$lte = new Date(req.query.to as string);
        match.date = dateFilter;
    }

    const pipeline = [
        { $match: match },
        {
            $group: {
                _id: "$classification.category",
                count: { $sum: 1 },
            },
        },
    ];

    const result = await Email.aggregate(pipeline);

    const stats: Record<string, number> = {};
    let total = 0;
    for (const cat of EMAIL_CATEGORIES) {
        stats[cat] = 0;
    }
    for (const r of result) {
        stats[r._id] = r.count;
        total += r.count;
    }
    stats.total = total;

    res.status(200).json(new ApiResponse(200, stats, "Email stats"));
});

// ─── Single email detail ─────────────────────────────────────────────────────

export const getEmailById = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findOne({
        _id: req.params.emailId,
        isDeleted: false,
    })
        .populate("linkedRfq", "prNumber companyName location status dueDate items");

    if (!email) throw new ApiError(404, "Email not found");

    res.status(200).json(new ApiResponse(200, email, "Email fetched"));
});

// ─── Sync ────────────────────────────────────────────────────────────────────

export const triggerSync = asyncHandler(async (_req: Request, res: Response) => {
    const count = await syncEmails();

    // Classify immediately after sync (don't wait for cron)
    if (count > 0) {
        classifyUnprocessed().catch(() => {});
    }

    res.status(200).json(new ApiResponse(200, { newEmails: count }, `Synced ${count} new emails`));
});

// ─── Re-classify ─────────────────────────────────────────────────────────────

export const reclassifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findById(req.params.emailId);
    if (!email) throw new ApiError(404, "Email not found");

    email.isProcessed = false;
    await email.save();
    const emailId = req.params.emailId as string;
    await classifyEmail(emailId);

    const updated = await Email.findById(emailId);
    res.status(200).json(new ApiResponse(200, updated, "Email re-classified"));
});

// ─── Mark read ───────────────────────────────────────────────────────────────

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findByIdAndUpdate(
        req.params.emailId,
        { isRead: true },
        { new: true }
    );
    if (!email) throw new ApiError(404, "Email not found");
    res.status(200).json(new ApiResponse(200, email, "Marked as read"));
});

export const markAllRead = asyncHandler(async (_req: Request, res: Response) => {
    await Email.updateMany(
        { isRead: false, isDeleted: false },
        { isRead: true }
    );
    res.status(200).json(new ApiResponse(200, null, "All emails marked as read"));
});

// ─── Archive ─────────────────────────────────────────────────────────────────

export const archiveEmail = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findByIdAndUpdate(
        req.params.emailId,
        { isArchived: true },
        { new: true }
    );
    if (!email) throw new ApiError(404, "Email not found");
    res.status(200).json(new ApiResponse(200, email, "Email archived"));
});

// ─── Link / Unlink ──────────────────────────────────────────────────────────

export const linkToRfq = asyncHandler(async (req: Request, res: Response) => {
    const { rfqId } = req.body;
    if (!rfqId || !mongoose.Types.ObjectId.isValid(rfqId)) {
        throw new ApiError(400, "Valid rfqId is required");
    }

    const email = await Email.findByIdAndUpdate(
        req.params.emailId,
        { linkedRfq: rfqId },
        { new: true }
    ).populate("linkedRfq", "prNumber companyName status");

    if (!email) throw new ApiError(404, "Email not found");
    res.status(200).json(new ApiResponse(200, email, "Linked to RFQ"));
});

export const unlinkEmail = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findByIdAndUpdate(
        req.params.emailId,
        { $unset: { linkedRfq: 1 } },
        { new: true }
    );
    if (!email) throw new ApiError(404, "Email not found");
    res.status(200).json(new ApiResponse(200, email, "Unlinked"));
});

// ─── Create RFQ from email ──────────────────────────────────────────────────

export const createRfqFromEmail = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findById(req.params.emailId);
    if (!email) throw new ApiError(404, "Email not found");

    // Find the best document to use for extraction
    let documentUrl: string | null = null;

    // 1. Check Ariba downloaded docs
    const downloadedAriba = email.aribaLinks.find(l => l.downloadStatus === "DOWNLOADED");
    if (downloadedAriba?.downloadedDocUrl) {
        documentUrl = downloadedAriba.downloadedDocUrl;
    }

    // 2. Check direct attachments
    if (!documentUrl) {
        const pdfAttachment = email.attachments.find(
            a =>
                a.cloudinaryUrl &&
                (a.contentType === "application/pdf" ||
                    a.contentType ===
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        );
        if (pdfAttachment?.cloudinaryUrl) {
            documentUrl = pdfAttachment.cloudinaryUrl;
        }
    }

    // Return pre-filled data for the frontend to use with the existing extraction pipeline
    const prefillData = {
        documentUrl,
        prNumber: email.classification.extractedData.prNumbers[0] || "",
        companyName: email.classification.extractedData.companyNames[0] || "",
        location: email.classification.extractedData.location || "",
        startDate: email.classification.extractedData.eventStartDate || null,
        dueDate: email.classification.extractedData.dueDate || null,
        emailId: email._id,
        source: email.source,
        attachments: email.attachments.filter(a => a.cloudinaryUrl),
        aribaLinks: email.aribaLinks,
    };

    res.status(200).json(
        new ApiResponse(200, prefillData, "Pre-fill data ready for RFQ creation")
    );
});

// ─── Ariba document download ────────────────────────────────────────────────

export const downloadAribaDoc = asyncHandler(async (req: Request, res: Response) => {
    const linkIndex = parseInt(req.params.linkIndex as string);
    const result = await downloadSingleAribaDoc(req.params.emailId as string, linkIndex);

    if (!result.success) {
        throw new ApiError(400, result.message);
    }

    res.status(200).json(new ApiResponse(200, result, result.message));
});

export const downloadAllAribaDocs = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findById(req.params.emailId);
    if (!email) throw new ApiError(404, "Email not found");

    let queued = 0;
    for (let i = 0; i < email.aribaLinks.length; i++) {
        const aribaLink = email.aribaLinks[i];
        if (aribaLink && (aribaLink.downloadStatus === "LINK_EXTRACTED" || aribaLink.downloadStatus === "FAILED")) {
            aribaLink.downloadStatus = "LINK_EXTRACTED";
            aribaLink.errorMessage = undefined;
            queued++;
        }
    }

    if (queued > 0) await email.save();

    res.status(200).json(
        new ApiResponse(200, { queued }, `${queued} download(s) queued`)
    );
});

// ─── Email Settings (Admin only) ────────────────────────────────────────────

export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
    const settings = await getEmailSettings();

    // Don't send raw encrypted passwords to frontend
    const safe = {
        imapHost: settings.imapHost,
        imapPort: settings.imapPort,
        imapUser: settings.imapUser,
        imapTls: settings.imapTls,
        syncEnabled: settings.syncEnabled,
        syncIntervalMinutes: settings.syncIntervalMinutes,
        lastSyncAt: settings.lastSyncAt,
        lastSyncUid: settings.lastSyncUid,
        aribaUsername: settings.aribaUsername,
        aribaAutoDownload: settings.aribaAutoDownload,
        hasImapPassword: !!settings.imapPassword,
        hasAribaPassword: !!settings.aribaPassword,
        senderWhitelist: settings.senderWhitelist || [],
    };

    res.status(200).json(new ApiResponse(200, safe, "Settings fetched"));
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
    const settings = await getEmailSettings();
    const {
        imapHost,
        imapPort,
        imapUser,
        imapPassword,
        imapTls,
        syncEnabled,
        syncIntervalMinutes,
        aribaUsername,
        aribaPassword,
        aribaAutoDownload,
        senderWhitelist,
    } = req.body;

    if (imapHost !== undefined) settings.imapHost = imapHost;
    if (imapPort !== undefined) settings.imapPort = imapPort;
    if (imapUser !== undefined) settings.imapUser = imapUser;
    if (imapPassword) settings.imapPassword = encryptPassword(imapPassword);
    if (imapTls !== undefined) settings.imapTls = imapTls;
    if (syncEnabled !== undefined) settings.syncEnabled = syncEnabled;
    if (syncIntervalMinutes !== undefined) settings.syncIntervalMinutes = syncIntervalMinutes;
    if (aribaUsername !== undefined) settings.aribaUsername = aribaUsername;
    if (aribaPassword) settings.aribaPassword = encryptPassword(aribaPassword);
    if (aribaAutoDownload !== undefined) settings.aribaAutoDownload = aribaAutoDownload;
    if (senderWhitelist !== undefined) settings.senderWhitelist = senderWhitelist;

    await settings.save();

    res.status(200).json(new ApiResponse(200, null, "Settings updated"));
});

export const testConnection = asyncHandler(async (req: Request, res: Response) => {
    const { imapHost, imapPort, imapUser, imapPassword, imapTls } = req.body;

    if (!imapHost || !imapUser || !imapPassword) {
        throw new ApiError(400, "IMAP host, user, and password are required");
    }

    const result = await testImapConnection(
        imapHost,
        imapPort || 993,
        imapUser,
        imapPassword,
        imapTls !== false
    );

    if (!result.success) {
        throw new ApiError(400, result.message);
    }

    res.status(200).json(new ApiResponse(200, result, result.message));
});

// ─── Re-extract Ariba links from existing emails ───────────────────────────

export const reExtractAriba = asyncHandler(async (_req: Request, res: Response) => {
    const updated = await reExtractAribaLinks();
    res.status(200).json(
        new ApiResponse(200, { updated }, `Re-extracted Ariba links from ${updated} email(s)`)
    );
});

// ─── Download Ariba doc + extract in one synchronous call ────────────────────

/**
 * Download a file from a URL to a local temp path.
 */
function downloadFileFromUrl(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const handler = url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(destPath);
        handler
            .get(url, response => {
                // Follow redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        file.close();
                        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                        downloadFileFromUrl(redirectUrl, destPath).then(resolve, reject);
                        return;
                    }
                }
                response.pipe(file);
                file.on("finish", () => {
                    file.close();
                    resolve();
                });
            })
            .on("error", err => {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                reject(err);
            });
    });
}

export const downloadAndExtractFromEmail = asyncHandler(async (req: Request, res: Response) => {
    const email = await Email.findById(req.params.emailId);
    if (!email) throw new ApiError(404, "Email not found");

    let fileUrl: string | null = null;
    let filename = "document";

    // 1. Check if Ariba doc already downloaded
    const downloadedAriba = email.aribaLinks.find(l => l.downloadStatus === "DOWNLOADED");
    if (downloadedAriba?.downloadedDocUrl) {
        fileUrl = downloadedAriba.downloadedDocUrl;
        filename = "ariba_document.doc";
    }

    // 2. Check email attachments
    if (!fileUrl) {
        const docAttachment = email.attachments.find(
            a =>
                a.cloudinaryUrl &&
                (a.contentType === "application/pdf" ||
                    a.contentType ===
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                    a.contentType === "application/msword")
        );
        if (docAttachment?.cloudinaryUrl) {
            fileUrl = docAttachment.cloudinaryUrl;
            filename = docAttachment.filename || "attachment.doc";
        }
    }

    // 3. No existing doc — download from Ariba via Puppeteer
    if (!fileUrl) {
        const aribaLink = email.aribaLinks.find(
            l => l.downloadStatus === "LINK_EXTRACTED" || l.downloadStatus === "FAILED"
        );

        if (!aribaLink) {
            throw new ApiError(400, "No document source available for this email");
        }

        if (aribaLink.downloadStatus === "DOWNLOADING") {
            throw new ApiError(409, "A download is already in progress for this document");
        }

        const settings = await getEmailSettings();
        if (!settings.aribaUsername || !settings.aribaPassword) {
            throw new ApiError(
                400,
                "Ariba credentials not configured. Go to Email Settings to set them up."
            );
        }

        const aribaPassword = decryptPassword(settings.aribaPassword);

        // Mark as downloading
        aribaLink.downloadStatus = "DOWNLOADING";
        await email.save();

        try {
            const result = await downloadAribaDocSync(
                aribaLink.url,
                settings.aribaUsername,
                aribaPassword
            );

            // Upload to Cloudinary
            const cloudResult = await uploadFileToCloudinary(result.filePath);
            if (!cloudResult) {
                aribaLink.downloadStatus = "FAILED";
                aribaLink.errorMessage = "Cloudinary upload failed";
                await email.save();
                // Cleanup
                if (fs.existsSync(result.downloadDir)) {
                    fs.rmSync(result.downloadDir, { recursive: true, force: true });
                }
                throw new ApiError(500, "Failed to upload downloaded file to cloud storage");
            }

            aribaLink.downloadedDocUrl = cloudResult.secure_url;
            aribaLink.downloadStatus = "DOWNLOADED";
            await email.save();

            fileUrl = cloudResult.secure_url;
            filename = result.filename;

            // Cleanup temp dir
            if (fs.existsSync(result.downloadDir)) {
                fs.rmSync(result.downloadDir, { recursive: true, force: true });
            }
        } catch (err) {
            // Update status on failure (if not already set above)
            const freshEmail = await Email.findById(email._id);
            if (freshEmail) {
                const link = freshEmail.aribaLinks.find(l => l.url === aribaLink.url);
                if (link && link.downloadStatus === "DOWNLOADING") {
                    link.downloadStatus = "FAILED";
                    link.errorMessage = err instanceof Error ? err.message : String(err);
                    await freshEmail.save();
                }
            }
            if (err instanceof ApiError) throw err;
            throw new ApiError(
                500,
                `Ariba download failed: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    // 4. Download file from URL to temp path for extraction
    const tmpDir = path.join(os.tmpdir(), `extract_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = path.extname(filename) || ".doc";
    const tmpFilePath = path.join(tmpDir, `document${ext}`);

    try {
        await downloadFileFromUrl(fileUrl, tmpFilePath);
    } catch (err) {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new ApiError(
            500,
            `Failed to download file for extraction: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    // 5. Run extraction pipeline
    let extractionResult;
    try {
        extractionResult = await runExtractionPipeline(tmpFilePath, filename);
    } catch (err) {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new ApiError(
            500,
            `Extraction failed: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    // Cleanup
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 6. Return extraction result in the same shape as /rfp-extract/upload
    res.status(200).json(
        new ApiResponse(
            200,
            {
                extraction: {
                    layer: extractionResult.layer,
                    status: extractionResult.status,
                    confidence: extractionResult.confidence,
                    errors: extractionResult.errors,
                },
                extractedData: extractionResult.data,
                rawText: extractionResult.data.rawText,
                fileUrl,
                originalFilename: filename,
            },
            extractionResult.success
                ? `Data extracted via ${extractionResult.layer} layer (${extractionResult.status})`
                : "Extraction failed — manual entry required"
        )
    );
});
