import cron from "node-cron";
import { syncEmails } from "../services/email/imapService";
import { classifyUnprocessed } from "../services/email/classificationService";
import { processAribaDownloads } from "../services/email/aribaScraperService";
import { autoCreateRfqsFromDownloads } from "../services/email/autoRfqService";
import { createDispatchDraftsInGmail, checkSentDispatchDrafts } from "../services/email/gmailDraftAutoService";
import { getEmailSettings } from "../models/emailSettings.model";

let scheduledTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Starts the email sync cron job.
 * Runs every 10 minutes (configurable via settings).
 * Called once after DB connection is established.
 */
export function startEmailScheduler(): void {
    // Default: every 10 minutes
    scheduledTask = cron.schedule("*/10 * * * *", async () => {
        try {
            const settings = await getEmailSettings();
            if (!settings.syncEnabled) return;

            console.log("[CRON] Running email sync...", new Date().toISOString());

            // Step 1: Fetch new emails from IMAP
            const newCount = await syncEmails();
            if (newCount > 0) {
                console.log(`[CRON] Fetched ${newCount} new emails`);
            }

            // Step 2: Classify unprocessed emails
            const classified = await classifyUnprocessed();
            if (classified > 0) {
                console.log(`[CRON] Classified ${classified} emails`);
            }

            // Step 3: Process pending Ariba downloads (only if enabled)
            const downloaded = await processAribaDownloads();
            if (downloaded > 0) {
                console.log(`[CRON] Downloaded ${downloaded} Ariba document(s)`);
            }

            // Step 4: Auto-create RFQs from downloaded documents (PREVIEW status)
            const autoCreated = await autoCreateRfqsFromDownloads();
            if (autoCreated > 0) {
                console.log(`[CRON] Auto-created ${autoCreated} RFQ(s) from downloaded documents`);
            }

            // Step 5: Auto-create Gmail drafts for dispatched-only PO/item requests
            // (no-op unless settings.autoGmailDraftEnabled is on)
            const draftsCreated = await createDispatchDraftsInGmail();
            if (draftsCreated > 0) {
                console.log(`[CRON] Created ${draftsCreated} Gmail dispatch-status draft(s)`);
            }

            // Step 6: Detect drafts sent from Gmail itself, update UI status
            const draftsMarkedSent = await checkSentDispatchDrafts();
            if (draftsMarkedSent > 0) {
                console.log(`[CRON] Marked ${draftsMarkedSent} dispatch draft(s) as sent`);
            }
        } catch (err) {
            console.error("[CRON] Email scheduler error:", err);
        }
    });

    console.log("[CRON] Email scheduler registered (runs every 10 minutes)");
}

/**
 * Stop the email scheduler (for graceful shutdown).
 */
export function stopEmailScheduler(): void {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
}
