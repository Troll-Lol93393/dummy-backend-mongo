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
            await new Promise(resolve => setTimeout(resolve, 500));
            await page.mouse.click(btnCoords.x, btnCoords.y);
            logger.info("ARIBA", `Clicked 'Print Event Information' at (${btnCoords.x}, ${btnCoords.y})`);

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
                    break;
                }
                logger.info("ARIBA", `${elapsed / 1000}s - waiting for download...`);
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
