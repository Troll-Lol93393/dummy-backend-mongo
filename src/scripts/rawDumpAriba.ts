/**
 * Raw DOM diagnostic for Ariba event page.
 * Logs in, waits for the event to load, then dumps:
 *   - ALL <a> tags with their href + text
 *   - All elements with onclick containing "download" or "pdf" or "file"
 *   - All img/embed/object src values
 *   - All frame URLs
 *   - A full-page screenshot
 *
 * Run:
 *   ARIBA_TEST_URL="https://..." npx tsx src/scripts/rawDumpAriba.ts
 */

import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import os from "os";
import { DB_NAME } from "../constants";
import { getEmailSettings } from "../models/emailSettings.model";
import { decryptPassword } from "../utils/emailEncryption";

async function main() {
    console.log("\n[1] Connecting to MongoDB...");
    await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
    console.log("    Connected.");

    const settings = await getEmailSettings();
    if (!settings.aribaUsername || !settings.aribaPassword) {
        console.error("    ERROR: Ariba credentials not configured."); process.exit(1);
    }
    const aribaPassword = decryptPassword(settings.aribaPassword);
    const testUrl = process.env.ARIBA_TEST_URL;
    if (!testUrl) { console.error("Set ARIBA_TEST_URL env var."); process.exit(1); }

    console.log(`\n[2] Launching browser → ${testUrl}`);

    let puppeteerModule: any;
    try { puppeteerModule = await import("puppeteer"); } catch { console.error("Install puppeteer."); process.exit(1); }

    const downloadDir = path.join(os.tmpdir(), `ariba_rawdump_${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    const browser = await puppeteerModule.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-popup-blocking"],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // CDP download config
        const cdp = await browser.target().createCDPSession();
        await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });

        page.setDefaultTimeout(60000);
        await page.goto(testUrl, { waitUntil: "networkidle2" }).catch(() => {});

        // --- Login (same as scraper) ---
        const loginField = await page.$('input[name="UserName"], input[name="username"], input[type="email"], input[id="UserNameInput"]');
        if (loginField) {
            await loginField.type(settings.aribaUsername);
            const pwdField = await page.$('input[name="Password"], input#Password, input[type="password"]:not(.displayNone)');
            if (pwdField) {
                await pwdField.type(aribaPassword);
                const btn = await page.$('input[type="submit"], button[type="submit"], button[id="login-button"]');
                if (btn) { await btn.click(); await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}); }
            }
        }
        await new Promise(r => setTimeout(r, 2000));
        // Skip "Set a New Password"
        await page.evaluate(`(function(){var t=document.body.innerText||"";if(t.indexOf("Set a New Password")===-1)return;var b=document.querySelectorAll("button,a");for(var i=0;i<b.length;i++){if((b[i].textContent||"").trim()==="Cancel"){b[i].click();return;}}})()`).catch(()=>{});

        // Wait for URL to stabilize (multi-hop Ariba redirects)
        let lastUrl = page.url();
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const cur = page.url();
            if (cur === lastUrl) break;
            lastUrl = cur;
            console.log(`    Redirect → ${cur}`);
        }
        // Extra wait for JS-rendered event content
        await new Promise(r => setTimeout(r, 4000));

        // Click "Technical Specifications" section in sidebar first
        const techClicked: boolean = await page.evaluate(`(function() {
            var all = document.querySelectorAll('a');
            for (var i = 0; i < all.length; i++) {
                var t = (all[i].textContent || '').trim();
                if (t === 'Technical Specificat...' || t === 'Technical Specifications') {
                    all[i].scrollIntoView({ block: 'center' });
                    var rect = all[i].getBoundingClientRect();
                    if (rect.width > 0) return true;  // found it - will click by coords
                }
            }
            return false;
        })()`).catch(() => false);

        if (techClicked) {
            // Get coords and click via mouse
            const techCoords: any = await page.evaluate(`(function() {
                var all = document.querySelectorAll('a');
                for (var i = 0; i < all.length; i++) {
                    var t = (all[i].textContent || '').trim();
                    if (t === 'Technical Specificat...' || t === 'Technical Specifications') {
                        all[i].scrollIntoView({ block: 'center' });
                        var r = all[i].getBoundingClientRect();
                        return { x: r.x + r.width/2, y: r.y + r.height/2 };
                    }
                }
                return null;
            })()`).catch(() => null);
            if (techCoords) {
                await page.mouse.click(techCoords.x, techCoords.y);
                console.log(`    Clicked 'Technical Specifications' at (${techCoords.x}, ${techCoords.y})`);
                await new Promise(r => setTimeout(r, 3000));
            }
        } else {
            console.log("    'Technical Specifications' link not found — dumping current section");
        }

        console.log(`\n[3] Settled on: ${page.url()}`);

        // Screenshot
        const screenshotPath = path.join(os.tmpdir(), `ariba_rawdump_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`    Screenshot: ${screenshotPath}`);

        // --- Frame inventory ---
        const frames = page.frames();
        console.log(`\n[4] FRAMES (${frames.length} total):`);
        frames.forEach((f: any, i: number) => console.log(`    [${i}] ${f.url()}`));

        // --- Raw dump helper: run in each frame ---
        const dumpFrame = async (frame: any, label: string) => {
            console.log(`\n--- FRAME: ${label} ---`);

            // All <a> tags
            const allLinks: { href: string; text: string; onclick: string }[] = await frame.evaluate(`(function(){
                var out = [];
                var anchors = document.querySelectorAll('a');
                for (var i = 0; i < anchors.length; i++) {
                    out.push({
                        href: anchors[i].href || anchors[i].getAttribute('href') || '',
                        text: (anchors[i].textContent || '').trim().substring(0, 80),
                        onclick: (anchors[i].getAttribute('onclick') || '').substring(0, 120)
                    });
                }
                return out;
            })()`).catch(() => []);

            console.log(`  <a> tags: ${allLinks.length}`);
            allLinks.forEach((l: any, i: number) => {
                const interesting = l.href.indexOf('.pdf') !== -1 || l.href.indexOf('.zip') !== -1
                    || l.href.indexOf('download') !== -1 || l.href.indexOf('Download') !== -1
                    || l.href.indexOf('FileDownload') !== -1 || l.href.indexOf('ViewFile') !== -1
                    || l.onclick.toLowerCase().indexOf('pdf') !== -1 || l.onclick.toLowerCase().indexOf('download') !== -1
                    || l.text.toLowerCase().indexOf('.pdf') !== -1 || l.text.toLowerCase().indexOf('.zip') !== -1;
                const prefix = interesting ? "  *** " : "      ";
                console.log(`${prefix}[${i}] href="${l.href.substring(0, 120)}"  text="${l.text}"  onclick="${l.onclick}"`);
            });

            // All elements with onclick containing download/pdf/file keywords
            const onclickEls: { tag: string; onclick: string; text: string }[] = await frame.evaluate(`(function(){
                var out = [];
                var all = document.querySelectorAll('[onclick]');
                for (var i = 0; i < all.length; i++) {
                    var oc = all[i].getAttribute('onclick') || '';
                    var low = oc.toLowerCase();
                    if (low.indexOf('pdf') !== -1 || low.indexOf('download') !== -1 || low.indexOf('file') !== -1 || low.indexOf('attach') !== -1) {
                        out.push({ tag: all[i].tagName, onclick: oc.substring(0, 200), text: (all[i].textContent || '').trim().substring(0, 60) });
                    }
                }
                return out;
            })()`).catch(() => []);

            if (onclickEls.length > 0) {
                console.log(`\n  onclick elements with download/pdf/file:`);
                onclickEls.forEach((el: any, i: number) => console.log(`    [${i}] <${el.tag}> text="${el.text}"  onclick="${el.onclick}"`));
            }

            // Elements whose text contains .pdf or .zip (filename hints)
            const pdfTextEls: { tag: string; text: string; href: string }[] = await frame.evaluate(`(function(){
                var out = [];
                var all = document.querySelectorAll('*');
                for (var i = 0; i < all.length; i++) {
                    // Only leaf-ish elements (direct text, short)
                    var ownText = '';
                    for (var j = 0; j < all[i].childNodes.length; j++) {
                        if (all[i].childNodes[j].nodeType === 3) ownText += all[i].childNodes[j].textContent || '';
                    }
                    ownText = ownText.trim();
                    if ((ownText.toLowerCase().indexOf('.pdf') !== -1 || ownText.toLowerCase().indexOf('.zip') !== -1) && ownText.length < 120) {
                        out.push({ tag: all[i].tagName, text: ownText, href: all[i].href || all[i].getAttribute('href') || '' });
                    }
                }
                return out;
            })()`).catch(() => []);

            if (pdfTextEls.length > 0) {
                console.log(`\n  Elements with .pdf/.zip in visible text:`);
                pdfTextEls.forEach((el: any, i: number) => console.log(`    [${i}] <${el.tag}> "${el.text}"  href="${el.href}"`));
            }
        };

        // Dump main frame
        await dumpFrame(page.mainFrame(), `MAIN (${page.url().substring(0, 80)})`);

        // Dump all child frames
        for (const frame of frames) {
            if (frame === page.mainFrame()) continue;
            const fUrl = frame.url();
            if (fUrl === "about:blank" || fUrl === "") continue;
            await dumpFrame(frame, fUrl.substring(0, 80));
        }

        // Check for any files that appeared in download dir
        const files = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : [];
        console.log(`\n[5] Files in download dir: ${files.length > 0 ? files.join(', ') : '(none)'}`);

    } finally {
        await browser.close().catch(() => {});
        fs.rmSync(downloadDir, { recursive: true, force: true });
        await mongoose.disconnect();
    }

    console.log("\nDone.\n");
}

main().catch(err => { console.error("Error:", err); process.exit(1); });
