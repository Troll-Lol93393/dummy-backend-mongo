import { Email } from "../../models/email.model";
import { getEmailSettings } from "../../models/emailSettings.model";
import { decryptPassword } from "../../utils/emailEncryption";
import { uploadFileToCloudinary } from "../../utils/cloudinary";
import { logger } from "../../utils/logger";
import fs from "fs";
import path from "path";
import os from "os";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Capture a debug screenshot on failure.
 * Saves full-page PNG to /tmp/ariba_debug_screenshots/.
 */
async function captureDebugScreenshot(
    page: any,
    label: string
): Promise<string | null> {
    try {
        const dir = path.join(os.tmpdir(), "ariba_debug_screenshots");
        fs.mkdirSync(dir, { recursive: true });
        const filename = `ariba_fail_${label}_${Date.now()}.png`;
        const screenshotPath = path.join(dir, filename);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info("ARIBA", `Debug screenshot saved: ${screenshotPath}`);
        return screenshotPath;
    } catch (err) {
        logger.warn("ARIBA", `Failed to capture debug screenshot: ${err}`);
        return null;
    }
}

/**
 * Core Puppeteer download logic — reusable by both cron and synchronous endpoint.
 * Launches browser, navigates to Ariba URL, logs in, downloads file.
 * Returns local file path + filename. Caller handles upload/DB updates.
 */
export async function downloadAribaDocSync(
    aribaUrl: string,
    aribaUsername: string,
    aribaPassword: string
): Promise<{ filePath: string; filename: string; downloadDir: string }> {
    let puppeteerModule: any;
    try {
        puppeteerModule = await import("puppeteer");
    } catch {
        throw new Error(
            "Puppeteer not installed. Install with: npm install puppeteer"
        );
    }

    let browser: any;
    try {
        // Detect system Chrome for cloud deployment (Render, etc.)
        const launchOptions: any = {
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-popup-blocking",
                "--single-process",
                "--no-zygote",
            ],
        };
        // Use PUPPETEER_EXECUTABLE_PATH if set (Render/Docker with system Chrome)
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        browser = await puppeteerModule.default.launch(launchOptions);

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        const downloadDir = path.join(os.tmpdir(), `ariba_${Date.now()}`);
        fs.mkdirSync(downloadDir, { recursive: true });

        // Configure downloads via CDP — use Browser-level session for reliable downloads
        const cdp = await page.createCDPSession();
        await cdp.send("Browser.setDownloadBehavior", {
            behavior: "allow",
            downloadPath: downloadDir,
            eventsEnabled: true,
        });

        page.setDefaultTimeout(60000);
        await page.goto(aribaUrl, { waitUntil: "networkidle2" }).catch(() => {
            // Ariba webjumper may detach frame during redirect — this is OK
        });

        // Login — handle multiple Ariba login page variants
        const loginField = await page.$(
            'input[name="UserName"], input[name="username"], input[type="email"], input[id="UserNameInput"]'
        );

        if (loginField) {
            await loginField.type(aribaUsername);
            // Use name/id selector — Ariba has a hidden decoy input[type="password"]
            const passwordField = await page.$(
                'input[name="Password"], input#Password, input[type="password"]:not(.displayNone)'
            );
            if (passwordField) {
                await passwordField.type(aribaPassword);
                const submitBtn = await page.$(
                    'input[type="submit"], button[type="submit"], button[id="login-button"]'
                );
                if (submitBtn) {
                    await submitBtn.click();
                    await page
                        .waitForNavigation({ waitUntil: "networkidle2" })
                        .catch(() => {});
                }
            } else {
                // Variant 2: Username first, then password on next page
                const nextBtn = await page.$(
                    'input[type="submit"], button[type="submit"], button:not([disabled])'
                );
                if (nextBtn) {
                    await nextBtn.click();
                    await page
                        .waitForNavigation({ waitUntil: "networkidle2" })
                        .catch(() => {});
                }
                const pwdField = await page.$(
                    'input[name="Password"], input#Password, input[type="password"]:not(.displayNone)'
                );
                if (pwdField) {
                    await pwdField.type(aribaPassword);
                    const submitBtn2 = await page.$(
                        'input[type="submit"], button[type="submit"]'
                    );
                    if (submitBtn2) {
                        await submitBtn2.click();
                        await page
                            .waitForNavigation({ waitUntil: "networkidle2" })
                            .catch(() => {});
                    }
                }
            }
        }
        // If no login field found — SSO redirect, already logged in

        // Handle post-login interstitials (password expiry, consent, etc.)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // SAP "Set a New Password" page — click Cancel to skip
        const skippedPwdPage = await page.evaluate(`(function() {
            var text = document.body.innerText || "";
            if (text.indexOf("Set a New Password") === -1 && text.indexOf("password will expire") === -1) return false;
            var btns = document.querySelectorAll("button, a");
            for (var i = 0; i < btns.length; i++) {
                if ((btns[i].textContent || "").trim() === "Cancel") { btns[i].click(); return true; }
            }
            return false;
        })()`);
        if (skippedPwdPage) {
            await page
                .waitForNavigation({ waitUntil: "networkidle2" })
                .catch(() => {});
        }

        // Wait for the event page to load after login
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Click "Print Event Information" BUTTON — triggers .doc file download
        // IMPORTANT: Must use page.mouse.click() with coordinates, NOT element.click()
        // The Ariba framework (bh="TB" widget) only responds to real mouse events
        const btnCoords: { x: number; y: number } | null = await page.evaluate(`(function() {
            var buttons = document.querySelectorAll("button");
            for (var i = 0; i < buttons.length; i++) {
                if ((buttons[i].textContent || "").trim() === "Print Event Information") {
                    buttons[i].scrollIntoView();
                    var rect = buttons[i].getBoundingClientRect();
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                }
            }
            return null;
        })()`);

        if (btnCoords) {
            // Retry click-and-poll up to 2 retries (3 total attempts)
            const MAX_CLICK_ATTEMPTS = 3;
            let downloadSuccess = false;

            for (let attempt = 0; attempt < MAX_CLICK_ATTEMPTS; attempt++) {
                if (attempt > 0) {
                    logger.warn("ARIBA", `Retrying click-and-poll (attempt ${attempt + 1}/${MAX_CLICK_ATTEMPTS})...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

                await new Promise(resolve => setTimeout(resolve, 500));
                await page.mouse.click(btnCoords.x, btnCoords.y);
                logger.info("ARIBA", `Clicked 'Print Event Information' at (${btnCoords.x}, ${btnCoords.y}) — attempt ${attempt + 1}`);

                // Wait for file to appear in download directory
                const maxWait = 45000;
                const pollInterval = 2000;
                let elapsed = 0;

                while (elapsed < maxWait) {
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    elapsed += pollInterval;
                    const dirFiles = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
                    const completed = dirFiles.filter(
                        f => !f.endsWith(".crdownload") && !f.endsWith(".tmp")
                    );
                    if (completed.length > 0) {
                        logger.info("ARIBA", `Download complete: ${completed[0]} (${elapsed / 1000}s)`);
                        downloadSuccess = true;
                        break;
                    }
                    logger.info("ARIBA", `${elapsed / 1000}s - waiting for download...`);
                }

                if (downloadSuccess) break;
            }

            if (!downloadSuccess) {
                await captureDebugScreenshot(page, "click_no_file");
                await page.close();
                if (fs.existsSync(downloadDir)) {
                    fs.rmSync(downloadDir, { recursive: true, force: true });
                }
                throw new Error("Ariba: 'Print Event Information' clicked but no file downloaded within timeout");
            }
        } else {
            // Fallback: try other download selectors
            const fallbackSelectors = [
                'a[href*="download"]',
                'a[href*="FileDownload"]',
                'a[title*="Download"]',
                'a[href$=".pdf"], a[href$=".docx"], a[href$=".doc"], a[href$=".xlsx"]',
            ];
            let downloadBtn: any = null;
            for (const selector of fallbackSelectors) {
                downloadBtn = await page.$(selector).catch(() => null);
                if (downloadBtn) break;
            }
            if (downloadBtn) {
                await downloadBtn.click();
                await new Promise(resolve => setTimeout(resolve, 15000));
            } else {
                await captureDebugScreenshot(page, "button_not_found");
                await page.close();
                if (fs.existsSync(downloadDir)) {
                    fs.rmSync(downloadDir, { recursive: true, force: true });
                }
                throw new Error("Ariba: 'Print Event Information' button not found, fallback selectors also failed");
            }
        }

        await page.close();

        // Check for downloaded files
        const files = fs.existsSync(downloadDir)
            ? fs.readdirSync(downloadDir)
            : [];
        if (files.length > 0 && files[0]) {
            return {
                filePath: path.join(downloadDir, files[0]),
                filename: files[0],
                downloadDir,
            };
        }

        // Cleanup on failure
        if (fs.existsSync(downloadDir)) {
            fs.rmSync(downloadDir, { recursive: true, force: true });
        }
        throw new Error("No file downloaded from Ariba page");
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch {
                // Ignore close errors
            }
        }
    }
}

/**
 * Process pending Ariba document downloads (cron job).
 * Only runs if aribaAutoDownload is enabled in settings.
 * Falls back gracefully — links always remain available for manual download.
 */
export async function processAribaDownloads(): Promise<number> {
    const settings = await getEmailSettings();

    if (!settings.aribaAutoDownload) {
        return 0;
    }

    if (!settings.aribaUsername || !settings.aribaPassword) {
        logger.warn("ARIBA", "Ariba credentials not configured, skipping auto-download");
        return 0;
    }

    const emails = await Email.find({
        isDeleted: false,
        "aribaLinks.downloadStatus": "LINK_EXTRACTED",
    }).limit(5);

    if (emails.length === 0) return 0;

    let downloaded = 0;
    const aribaPassword = decryptPassword(settings.aribaPassword);

    for (const email of emails) {
        for (let i = 0; i < email.aribaLinks.length; i++) {
            const aribaLink = email.aribaLinks[i];
            if (!aribaLink || aribaLink.downloadStatus !== "LINK_EXTRACTED") continue;

            aribaLink.downloadStatus = "DOWNLOADING";
            await email.save();

            try {
                const result = await downloadAribaDocSync(
                    aribaLink.url,
                    settings.aribaUsername,
                    aribaPassword
                );

                const cloudResult = await uploadFileToCloudinary(result.filePath);
                if (cloudResult) {
                    aribaLink.downloadedDocUrl = cloudResult.secure_url;
                    aribaLink.downloadedDocFilename = result.filename;
                    aribaLink.downloadStatus = "DOWNLOADED";
                    downloaded++;
                } else {
                    aribaLink.downloadStatus = "FAILED";
                    aribaLink.errorMessage = "Cloudinary upload failed";
                }

                // Cleanup temp dir
                if (fs.existsSync(result.downloadDir)) {
                    fs.rmSync(result.downloadDir, { recursive: true, force: true });
                }

                // Download drawings from the same Ariba link — only for emails received on/after April 15 2026
                // (date gate prevents reprocessing all historical emails and avoids excessive Puppeteer sessions)
                const DRAWINGS_DATE_GATE = new Date("2026-04-15T00:00:00.000Z");
                const emailDate = email.date instanceof Date ? email.date : new Date(email.date);
                if (
                    aribaLink.downloadStatus === "DOWNLOADED" &&
                    emailDate >= DRAWINGS_DATE_GATE &&
                    (!aribaLink.drawings || aribaLink.drawings.length === 0)
                ) {
                    try {
                        logger.info("ARIBA", `Downloading drawings for ${aribaLink.url.substring(0, 60)}`);
                        const drawingResult = await discoverAribaDrawings(
                            aribaLink.url,
                            settings.aribaUsername,
                            aribaPassword
                        );
                        const uploadedDrawings: { url: string; filename: string }[] = [];
                        for (const drawing of drawingResult.drawings) {
                            if (fs.existsSync(drawing.filePath)) {
                                try {
                                    const cloudDrawing = await uploadFileToCloudinary(drawing.filePath);
                                    if (cloudDrawing?.secure_url) {
                                        uploadedDrawings.push({ url: cloudDrawing.secure_url, filename: drawing.filename });
                                    }
                                } catch { /* non-critical */ }
                            }
                        }
                        if (uploadedDrawings.length > 0) {
                            aribaLink.drawings = uploadedDrawings;
                            logger.info("ARIBA", `Stored ${uploadedDrawings.length} drawing(s) on email ${email._id}`);
                        }
                        // Cleanup drawing temp dir and screenshot
                        if (fs.existsSync(drawingResult.downloadDir)) {
                            fs.rmSync(drawingResult.downloadDir, { recursive: true, force: true });
                        }
                        if (drawingResult.screenshotPath && fs.existsSync(drawingResult.screenshotPath)) {
                            try { fs.unlinkSync(drawingResult.screenshotPath); } catch { /* ignore */ }
                        }
                    } catch (drawErr) {
                        logger.warn("ARIBA", `Drawing download skipped (non-critical): ${drawErr}`);
                    }
                }
            } catch (err) {
                aribaLink.downloadStatus = "FAILED";
                aribaLink.errorMessage =
                    err instanceof Error ? err.message : String(err);
                logger.error(
                    "ARIBA",
                    `Failed to download Ariba doc: ${aribaLink.url}`,
                    { error: String(err) }
                );
            }

            await email.save();
        }
    }

    if (downloaded > 0) {
        logger.info("ARIBA", `Downloaded ${downloaded} Ariba document(s)`);
    }

    return downloaded;
}

/**
 * Discovery script — find and attempt to download drawing attachments from an Ariba RFQ page.
 * Used to inspect the real DOM structure before wiring into the cron pipeline.
 * Returns a screenshot, all candidate attachment links found, and any files that were downloaded.
 */
export async function discoverAribaDrawings(
    aribaUrl: string,
    aribaUsername: string,
    aribaPassword: string
): Promise<{
    drawings: { filePath: string; filename: string }[];
    screenshotPath: string | null;
    candidateLinks: string[];
    downloadDir: string;
}> {
    let puppeteerModule: any;
    try {
        puppeteerModule = await import("puppeteer");
    } catch {
        throw new Error("Puppeteer not installed. Install with: npm install puppeteer");
    }

    let browser: any;
    const downloadDir = path.join(os.tmpdir(), `ariba_drawings_${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    const isPageAlive = (p: any): boolean => {
        try { return !p.isClosed(); } catch { return false; }
    };

    const pollForNewFiles = async (snapshot: string[], maxMs: number): Promise<string[]> => {
        const interval = 1000;
        let elapsed = 0;
        while (elapsed < maxMs) {
            await new Promise(r => setTimeout(r, interval));
            elapsed += interval;
            const now = fs.existsSync(downloadDir)
                ? fs.readdirSync(downloadDir).filter(f => !f.endsWith(".crdownload") && !f.endsWith(".tmp"))
                : [];
            const added = now.filter(f => !snapshot.includes(f));
            if (added.length > 0) return added;
        }
        return [];
    };

    try {
        const launchOptions: any = {
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-popup-blocking"],
        };
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        browser = await puppeteerModule.default.launch(launchOptions);

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const cdp = await browser.target().createCDPSession();
        await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });

        page.setDefaultTimeout(60000);
        await page.goto(aribaUrl, { waitUntil: "networkidle2" }).catch(() => {});

        // Login
        const loginField = await page.$('input[name="UserName"], input[name="username"], input[type="email"], input[id="UserNameInput"]');
        if (loginField) {
            await loginField.type(aribaUsername);
            const passwordField = await page.$('input[name="Password"], input#Password, input[type="password"]:not(.displayNone)');
            if (passwordField) {
                await passwordField.type(aribaPassword);
                const submitBtn = await page.$('input[type="submit"], button[type="submit"], button[id="login-button"]');
                if (submitBtn) { await submitBtn.click(); await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}); }
            } else {
                const nextBtn = await page.$('input[type="submit"], button[type="submit"], button:not([disabled])');
                if (nextBtn) { await nextBtn.click(); await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}); }
                const pwdField = await page.$('input[name="Password"], input#Password, input[type="password"]:not(.displayNone)');
                if (pwdField) {
                    await pwdField.type(aribaPassword);
                    const submitBtn2 = await page.$('input[type="submit"], button[type="submit"]');
                    if (submitBtn2) { await submitBtn2.click(); await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}); }
                }
            }
        }

        await new Promise(r => setTimeout(r, 2000));
        const skippedPwd = await page.evaluate(`(function() {
            var t = document.body.innerText || "";
            if (t.indexOf("Set a New Password") === -1 && t.indexOf("password will expire") === -1) return false;
            var b = document.querySelectorAll("button, a");
            for (var i = 0; i < b.length; i++) { if ((b[i].textContent || "").trim() === "Cancel") { b[i].click(); return true; } }
            return false;
        })()`).catch(() => false);
        if (skippedPwd) await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});

        // Wait for URL to stabilise (multi-hop SSO redirects)
        let lastUrl = page.url();
        for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const cur = page.url();
            if (cur === lastUrl) break;
            lastUrl = cur;
        }

        const pageBodyText: string = await page.evaluate(`document.body.innerText || ""`).catch(() => "") as string;
        const landedOnDashboard = pageBodyText.includes("Status: Open") || pageBodyText.includes("Status: Completed (");
        logger.info("ARIBA_DRAWINGS", `Settled: ${page.url().substring(0, 80)} | dashboard: ${landedOnDashboard}`);

        if (landedOnDashboard) {
            const openRowCoords: { x: number; y: number } | null = await page.evaluate(`(function() {
                var all = document.querySelectorAll('tr, td, div, span, a');
                for (var i = 0; i < all.length; i++) {
                    var t = (all[i].textContent || '').trim();
                    if (t.indexOf('Status: Open') === 0 && t.length < 35) {
                        var r = all[i].getBoundingClientRect();
                        if (r.width > 10 && r.height > 5) {
                            all[i].scrollIntoView({ block: 'center' });
                            var r2 = all[i].getBoundingClientRect();
                            return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
                        }
                    }
                }
                return null;
            })()`).catch(() => null) as { x: number; y: number } | null;

            if (openRowCoords && openRowCoords.x > 0) {
                await page.mouse.click(openRowCoords.x, openRowCoords.y);
                await new Promise(r => setTimeout(r, 4000));
                const eventCoords: { x: number; y: number } | null = await page.evaluate(`(function() {
                    var links = document.querySelectorAll('a[href]');
                    for (var i = 0; i < links.length; i++) {
                        var href = (links[i].href || '').trim();
                        if (href.indexOf('awh=r') !== -1 && href.indexOf('realm=') !== -1) {
                            var r = links[i].getBoundingClientRect();
                            if (r.width > 0 && r.y > 150 && r.y < 900) {
                                links[i].scrollIntoView({ block: 'center' });
                                var r2 = links[i].getBoundingClientRect();
                                return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
                            }
                        }
                    }
                    return null;
                })()`).catch(() => null) as { x: number; y: number } | null;
                if (eventCoords && eventCoords.x > 0) {
                    await page.mouse.click(eventCoords.x, eventCoords.y);
                    await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }

        // Collect attachment filenames by <a> TEXT (not href — Ariba SPA makes all hrefs identical)
        const collectFilenames = async (): Promise<string[]> => {
            return page.evaluate(`(function() {
                var exts = ['.pdf', '.zip', '.jpg', '.jpeg', '.png', '.dwg', '.dxf'];
                var results = [];
                var anchors = document.querySelectorAll('a');
                for (var i = 0; i < anchors.length; i++) {
                    var text = (anchors[i].textContent || '').trim();
                    var lower = text.toLowerCase();
                    for (var e = 0; e < exts.length; e++) {
                        if (lower.indexOf(exts[e]) !== -1 && text.length < 200) {
                            if (results.indexOf(text) === -1) results.push(text);
                            break;
                        }
                    }
                }
                return results;
            })()`).catch(() => []) as Promise<string[]>;
        };

        // Two-pass findByText: scroll first (pass 1) → wait → measure (pass 2)
        const findByText = async (searchText: string): Promise<{ x: number; y: number } | null> => {
            const found = await page.evaluate(`(function(s) {
                var all = document.querySelectorAll('a, button, span, td, div');
                for (var i = 0; i < all.length; i++) {
                    if ((all[i].textContent || '').trim() === s) { all[i].scrollIntoView({ block: 'center', behavior: 'instant' }); return true; }
                }
                return false;
            })(${JSON.stringify(searchText)})`).catch(() => false) as boolean;
            if (!found) return null;
            await new Promise(r => setTimeout(r, 400));
            return page.evaluate(`(function(s) {
                var all = document.querySelectorAll('a, button, span, td, div');
                for (var i = 0; i < all.length; i++) {
                    if ((all[i].textContent || '').trim() === s) {
                        var r = all[i].getBoundingClientRect();
                        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                    }
                }
                return null;
            })(${JSON.stringify(searchText)})`).catch(() => null) as { x: number; y: number } | null;
        };

        const candidateLinks: string[] = await collectFilenames();

        // Navigate to "Technical Specifications" section
        const techCoords = await findByText("Technical Specificat...") ?? await findByText("Technical Specifications");
        if (techCoords && techCoords.x > 0) {
            await page.mouse.click(techCoords.x, techCoords.y);
            // Poll for filenames to appear (up to 12s) instead of fixed wait
            let waited = 0;
            while (waited < 12000) {
                await new Promise(r => setTimeout(r, 1000));
                waited += 1000;
                if ((await collectFilenames()).length > 0) break;
            }
        }

        // Screenshot after navigating to the correct section
        let screenshotPath: string | null = null;
        try {
            screenshotPath = path.join(os.tmpdir(), `ariba_drawings_${Date.now()}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
        } catch { screenshotPath = null; }

        const techSpecFilenames = await collectFilenames();
        for (const f of techSpecFilenames) {
            if (candidateLinks.indexOf(f) === -1) candidateLinks.push(f);
        }
        logger.info("ARIBA_DRAWINGS", `Attachments found: [${techSpecFilenames.join(", ")}]`);

        const drawings: { filePath: string; filename: string }[] = [];

        // For each attachment filename: click its center to open the dropdown (▼),
        // wait for "Download this attachment" to become visible, then click it.
        for (const fname of techSpecFilenames) {
            if (!isPageAlive(page)) break;

            // Scroll filename into view and get its center coords
            await page.evaluate(`(function(s) {
                var all = document.querySelectorAll('a, td, span');
                for (var i = 0; i < all.length; i++) {
                    if ((all[i].textContent || '').trim() === s) { all[i].scrollIntoView({ block: 'center', behavior: 'instant' }); return; }
                }
            })(${JSON.stringify(fname)})`).catch(() => {});
            await new Promise(r => setTimeout(r, 300));

            const fnameCoords: { cx: number; cy: number } | null = await page.evaluate(`(function(s) {
                var all = document.querySelectorAll('a, td, span');
                for (var i = 0; i < all.length; i++) {
                    if ((all[i].textContent || '').trim() === s) {
                        var r = all[i].getBoundingClientRect();
                        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
                    }
                }
                return null;
            })(${JSON.stringify(fname)})`).catch(() => null) as { cx: number; cy: number } | null;

            if (!fnameCoords) {
                logger.warn("ARIBA_DRAWINGS", `Could not locate element for '${fname}'`);
                continue;
            }

            // Click filename center to open the action dropdown
            await page.mouse.click(fnameCoords.cx, fnameCoords.cy);
            await new Promise(r => setTimeout(r, 800));

            // Find the now-visible "Download this attachment" or "Download all attachments" button
            const dlBtn: { x: number; y: number } | null = await page.evaluate(`(function() {
                var all = document.querySelectorAll('a, button, li, span, td, div');
                for (var i = 0; i < all.length; i++) {
                    var t = (all[i].textContent || '').trim().toLowerCase();
                    if (t === 'download this attachment' || t === 'download all attachments') {
                        var r = all[i].getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                    }
                }
                return null;
            })()`).catch(() => null) as { x: number; y: number } | null;

            if (dlBtn && isPageAlive(page)) {
                logger.info("ARIBA_DRAWINGS", `Clicking download button for '${fname}' at (${dlBtn.x.toFixed(0)}, ${dlBtn.y.toFixed(0)})`);
                const snapshot = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
                await page.mouse.click(dlBtn.x, dlBtn.y);
                const added = await pollForNewFiles(snapshot, 30000);
                for (const f of added) {
                    drawings.push({ filePath: path.join(downloadDir, f), filename: f });
                    logger.info("ARIBA_DRAWINGS", `Downloaded: ${f}`);
                }
            } else {
                logger.warn("ARIBA_DRAWINGS", `Download button not visible for '${fname}' — skipping`);
            }
        }

        if (isPageAlive(page)) await page.close().catch(() => {});
        logger.info("ARIBA_DRAWINGS", `Done. ${drawings.length} drawing(s) downloaded, ${candidateLinks.length} filename(s) found.`);
        return { drawings, screenshotPath, candidateLinks, downloadDir };
    } finally {
        if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    }
}

/**
 * Trigger download for a specific Ariba link on an email.
 */
export async function downloadSingleAribaDoc(
    emailId: string,
    linkIndex: number
): Promise<{ success: boolean; message: string }> {
    const email = await Email.findById(emailId);
    if (!email) return { success: false, message: "Email not found" };

    const aribaLink = email.aribaLinks[linkIndex];
    if (!aribaLink) return { success: false, message: "Link index out of range" };

    const settings = await getEmailSettings();
    if (!settings.aribaAutoDownload) {
        return {
            success: false,
            message: "Ariba auto-download is disabled. Enable it in Email Settings or download manually via the Ariba link.",
        };
    }

    aribaLink.downloadStatus = "LINK_EXTRACTED";
    aribaLink.errorMessage = undefined;
    await email.save();

    return {
        success: true,
        message: "Download queued. It will be processed in the next sync cycle.",
    };
}
