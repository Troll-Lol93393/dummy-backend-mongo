import { Email } from "../../models/email.model";
import { getEmailSettings } from "../../models/emailSettings.model";
import { RFQ } from "../../models/rfq.models";
import { RFQItems } from "../../models/rfqItems.model";
import { Item } from "../../models/item.model";
import { ItemTechSpecs } from "../../models/item.techSpecs.model";
import { CommercialSpecs } from "../../models/item.commercial.model";
import { runExtractionPipeline } from "../extraction/extractionOrchestrator";
import { ParsedItem } from "../extraction/docParser";
import { logger } from "../../utils/logger";
import { autoMapRfqDrawingsToItems } from "../rfq/drawingMapper.service";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";

// Categories that should trigger auto-RFQ creation
const AUTO_RFQ_CATEGORIES = ["NEW_RFQ", "RFQ_REMINDER", "RFQ_REOPENED"];

/**
 * Download a file from a URL to a local temp path.
 */
function downloadFileFromUrl(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const handler = url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(destPath);
        handler
            .get(url, response => {
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

/**
 * Automatically create RFQs from emails that have downloaded Ariba documents
 * but aren't linked to an RFQ yet.
 *
 * Only processes emails classified as NEW_RFQ, RFQ_REMINDER, or RFQ_REOPENED.
 * Creates RFQs in PREVIEW status so they can be reviewed before being finalized.
 * Skips if an RFQ with the same PR number already exists.
 */
export async function autoCreateRfqsFromDownloads(): Promise<number> {
    const settings = await getEmailSettings();
    if (!settings.autoCreateRfqEnabled) return 0;

    // Find emails with downloaded Ariba docs ONLY — no linked RFQ, and relevant category
    // We intentionally skip emails that only have attachments (no Ariba doc),
    // because attachment data is unreliable. RFQs must be created from Ariba documents.
    const emails = await Email.find({
        isDeleted: false,
        linkedRfq: { $eq: null },
        "classification.category": { $in: AUTO_RFQ_CATEGORIES },
        "aribaLinks.downloadStatus": "DOWNLOADED",
        date: { $gte: new Date("2026-04-05T00:00:00.000Z") },
        extractionFailCount: { $lt: 3 },
    }).limit(5);

    if (emails.length === 0) return 0;

    let created = 0;

    for (const email of emails) {
        try {
            // Only use Ariba downloaded documents — never fall back to email attachments
            const downloadedAriba = email.aribaLinks.find(
                l => l.downloadStatus === "DOWNLOADED" && l.downloadedDocUrl
            );
            if (!downloadedAriba?.downloadedDocUrl) {
                logger.warn(
                    "AUTO-RFQ",
                    `Skipping email ${email._id} — no downloaded Ariba document available`
                );
                continue;
            }

            const fileUrl = downloadedAriba.downloadedDocUrl;
            // Use the original filename from the Ariba download (stored when Puppeteer downloaded it)
            // This preserves the RFP filename pattern that the parser relies on
            const filename = downloadedAriba.downloadedDocFilename || "ariba_document.doc";

            // Download file to temp directory
            const tmpDir = path.join(os.tmpdir(), `auto_rfq_${Date.now()}_${email._id}`);
            fs.mkdirSync(tmpDir, { recursive: true });
            const ext = path.extname(filename) || ".doc";
            const tmpFilePath = path.join(tmpDir, `document${ext}`);

            try {
                await downloadFileFromUrl(fileUrl, tmpFilePath);
            } catch (err) {
                logger.error("AUTO-RFQ", `Failed to download file for email ${email._id}`, {
                    error: String(err),
                });
                if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
                continue;
            }

            // Run extraction pipeline
            let extractionResult;
            try {
                extractionResult = await runExtractionPipeline(tmpFilePath, filename);
            } catch (err) {
                logger.error("AUTO-RFQ", `Extraction failed for email ${email._id}`, {
                    error: String(err),
                });
                if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
                continue;
            }

            // Cleanup temp
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }

            // Need minimum data to create an RFQ
            const data = extractionResult.data;
            if (!data.prNumber || !data.location || !data.companyName) {
                email.extractionFailCount = (email.extractionFailCount || 0) + 1;
                await email.save();
                logger.warn(
                    "AUTO-RFQ",
                    `Skipping email ${email._id} (fail #${email.extractionFailCount}) — missing required fields (prNumber: ${data.prNumber || "empty"}, location: ${data.location || "empty"}, company: ${data.companyName || "empty"})`
                );
                continue;
            }

            if (!data.items || data.items.length === 0) {
                email.extractionFailCount = (email.extractionFailCount || 0) + 1;
                await email.save();
                logger.warn("AUTO-RFQ", `Skipping email ${email._id} (fail #${email.extractionFailCount}) — no items extracted`);
                continue;
            }

            // Check for duplicate RFQ
            const existingRfq = await RFQ.findOne({
                prNumber: data.prNumber,
                isDeleted: false,
            });
            if (existingRfq) {
                // Link the email to the existing RFQ instead
                email.linkedRfq = existingRfq._id;
                await email.save();
                // Copy any new drawings from this email to the existing RFQ
                const newDrawings = (downloadedAriba.drawings || []).filter(
                    d => !existingRfq.drawings.some((r: { url: string }) => r.url === d.url)
                );
                if (newDrawings.length > 0) {
                    existingRfq.drawings.push(...newDrawings.map(d => ({ url: d.url, filename: d.filename })));
                    await existingRfq.save();
                    await autoMapRfqDrawingsToItems(existingRfq._id.toString());
                    logger.info("AUTO-RFQ", `Copied ${newDrawings.length} drawing(s) to existing RFQ ${existingRfq.prNumber}`);
                }
                logger.info("AUTO-RFQ", `Email ${email._id} linked to existing RFQ ${existingRfq.prNumber}`);
                continue;
            }

            // Create RFQ items
            const createdRfqItemIds: string[] = [];

            for (const rawItem of data.items as ParsedItem[]) {
                // Find or create master Item
                let item = await Item.findOne({
                    itemCode: rawItem.itemCode,
                    isDeleted: false,
                });

                if (!item) {
                    if (!rawItem.itemCode || !rawItem.itemName) continue;
                    item = await Item.create({
                        itemCode: rawItem.itemCode,
                        itemName: rawItem.itemName,
                        itemDesc: rawItem.itemDesc || rawItem.itemName,
                        itemType: rawItem.itemType || "UNIT",
                        size: "",
                        isDeleted: false,
                    });
                }

                const techSpecs = await ItemTechSpecs.create({
                    material: rawItem.technical?.material || "",
                    diameter: rawItem.technical?.diameter || "",
                    length: rawItem.technical?.length || "",
                    weight: rawItem.technical?.weight || "",
                    grade: rawItem.technical?.grade || "",
                });

                const commercialSpecs = await CommercialSpecs.create({
                    currency: "INR",
                    rawMaterialCost: 0,
                    laborCost: 0,
                    profitMargin: 0,
                    totalCost: 0,
                    packingCost: 0,
                    shippingCost: 0,
                    sellingPrice: 0,
                    otherCosts: 0,
                });

                const rfqItem = await RFQItems.create({
                    serialNumber: rawItem.serialNumber || "",
                    item: item._id,
                    quantity: rawItem.quantity || 1,
                    drawingNumber: rawItem.drawingNumber || "",
                    drawingUrl: "",
                    itemTechSpecs: techSpecs._id,
                    commercialSpecs: commercialSpecs._id,
                    isDeleted: false,
                });

                createdRfqItemIds.push(rfqItem._id.toString());
            }

            if (createdRfqItemIds.length === 0) {
                logger.warn("AUTO-RFQ", `Skipping email ${email._id} — no valid items to create`);
                continue;
            }

            // Create the RFQ in PREVIEW status
            // Dates from extraction are already ISO 8601 strings (parsed from Ariba's M/D/YYYY HH:mm AM/PM format)
            const parsedStartDate = data.startDate ? new Date(data.startDate) : null;
            const parsedDueDate = data.dueDate ? new Date(data.dueDate) : null;
            // Carry over any drawings already downloaded from the Ariba link
            const drawings = (downloadedAriba.drawings || []).map(d => ({ url: d.url, filename: d.filename }));
            const rfq = await RFQ.create({
                prNumber: data.prNumber,
                startDate: parsedStartDate && !isNaN(parsedStartDate.getTime())
                    ? parsedStartDate
                    : new Date(),
                dueDate: parsedDueDate && !isNaN(parsedDueDate.getTime())
                    ? parsedDueDate
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                ownerName: "",
                companyName: data.companyName,
                location: data.location,
                drawings,
                items: createdRfqItemIds,
                isQuoted: false,
                isDeleted: false,
                status: "PREVIEW",
                createdBy: "system-auto",
                updatedBy: "system-auto",
            });

            await autoMapRfqDrawingsToItems(rfq._id.toString());

            // Link email to the new RFQ
            email.linkedRfq = rfq._id;
            await email.save();

            created++;
            logger.info(
                "AUTO-RFQ",
                `Auto-created RFQ ${data.prNumber} (${data.companyName}) from email ${email._id} — ${createdRfqItemIds.length} items, confidence: ${extractionResult.confidence}%`
            );
        } catch (err) {
            logger.error("AUTO-RFQ", `Failed to auto-create RFQ from email ${email._id}`, {
                error: String(err),
            });
        }
    }

    return created;
}
