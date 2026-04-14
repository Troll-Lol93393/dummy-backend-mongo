/**
 * Standalone test: connect to DB, pull a real Ariba URL + credentials,
 * run discoverAribaDrawings(), and print the results.
 *
 * Run from dummy-backend-mongo/:
 *   npx tsx src/scripts/testDiscoverDrawings.ts
 *
 * Optional override — skip DB lookup and use a URL directly:
 *   ARIBA_TEST_URL="https://..." npx tsx src/scripts/testDiscoverDrawings.ts
 */

import "dotenv/config";
import mongoose from "mongoose";
import { DB_NAME } from "../constants";
import { getEmailSettings } from "../models/emailSettings.model";
import { Email } from "../models/email.model";
import { decryptPassword } from "../utils/emailEncryption";
import { discoverAribaDrawings } from "../services/email/aribaScraperService";

async function main() {
    // 1. Connect to DB
    console.log("\n[1] Connecting to MongoDB...");
    await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
    console.log("    Connected.");

    // 2. Load Ariba credentials from EmailSettings
    console.log("\n[2] Loading Ariba credentials from EmailSettings...");
    const settings = await getEmailSettings();

    if (!settings.aribaUsername || !settings.aribaPassword) {
        console.error("    ERROR: Ariba credentials not set in EmailSettings. Configure them in the app first.");
        process.exit(1);
    }
    console.log(`    Username: ${settings.aribaUsername}`);
    const aribaPassword = decryptPassword(settings.aribaPassword);

    // 3. Find an Ariba URL to test with
    let testUrl: string | undefined = process.env.ARIBA_TEST_URL;
    // If set to "dashboard", use the Ariba supplier portal home and let the script navigate in
    const navigateFromDashboard = testUrl === "dashboard";
    if (navigateFromDashboard) testUrl = undefined;

    if (!testUrl) {
        console.log("\n[3] Searching for existing Ariba links in emails...");
        const email = await Email.findOne({
            isDeleted: false,
            "aribaLinks.0": { $exists: true },
        }).sort({ date: -1 });

        if (!email || email.aribaLinks.length === 0) {
            console.error("    ERROR: No emails with Ariba links found in DB. Pass ARIBA_TEST_URL env var to override.");
            process.exit(1);
        }

        const link = email.aribaLinks[0];
        testUrl = link!.url;
        console.log(`    Found link (status: ${link!.downloadStatus}): ${testUrl}`);
        console.log(`    Email subject: ${email.subject}`);
    } else if (!navigateFromDashboard) {
        console.log(`\n[3] Using ARIBA_TEST_URL from environment: ${testUrl}`);
    }

    // 4. Run discovery
    console.log("\n[4] Running discoverAribaDrawings()...");
    console.log("    This will open a headless browser — may take 30-90 seconds.\n");

    const startTime = Date.now();
    let result: Awaited<ReturnType<typeof discoverAribaDrawings>>;

    try {
        result = await discoverAribaDrawings(testUrl, settings.aribaUsername, aribaPassword);
    } catch (err) {
        console.error("\n    DISCOVERY FAILED:", err instanceof Error ? err.message : String(err));
        await mongoose.disconnect();
        process.exit(1);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[5] Discovery completed in ${elapsed}s\n`);

    // 5. Print results
    console.log("=".repeat(60));
    console.log("SCREENSHOT:");
    console.log(result.screenshotPath
        ? `  Saved to: ${result.screenshotPath}`
        : "  No screenshot captured.");

    console.log("\nCANDIDATE LINKS (" + result.candidateLinks.length + " found):");
    if (result.candidateLinks.length === 0) {
        console.log("  (none) — page may not have loaded correctly, check screenshot");
    } else {
        result.candidateLinks.forEach((link, i) => {
            console.log(`  [${i + 1}] ${link}`);
        });
    }

    console.log("\nDOWNLOADED DRAWINGS (" + result.drawings.length + " downloaded):");
    if (result.drawings.length === 0) {
        console.log("  (none)");
    } else {
        result.drawings.forEach((d, i) => {
            console.log(`  [${i + 1}] ${d.filename}`);
            console.log(`       path: ${d.filePath}`);
        });
    }
    console.log("=".repeat(60));

    // 6. Diagnosis
    console.log("\nDIAGNOSIS:");
    if (result.candidateLinks.length === 0 && result.drawings.length === 0) {
        console.log("  No attachment links found at all.");
        console.log("  -> Check the screenshot to confirm login succeeded.");
        console.log("  -> Ariba may use iframes or shadow DOM — selectors may need updating.");
    } else if (result.drawings.length === 0) {
        console.log("  Links found but no files downloaded.");
        console.log("  -> The candidate links above are clickable/navigable but didn't trigger a download.");
        console.log("  -> Phase 2: identify which link is the drawing and use page.mouse.click() with coordinates.");
    } else {
        console.log("  SUCCESS — drawings downloaded. Ready for Phase 2 wiring into the cron.");
    }

    await mongoose.disconnect();
    console.log("\nDone.\n");
}

main().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
});
