import cron from "node-cron";
import { RFQ } from "../models/rfq.models";
import { Notification } from "../models/notification.model";
import { PORegister } from "../models/poRegister.model";

/**
 * Starts all RFQ-related cron jobs.
 * Called once after DB connection is established.
 */
export function startRfqScheduler(): void {
    // Run every day at 9:00 AM
    cron.schedule("0 9 * * *", async () => {
        console.log("[CRON] Running RFQ scheduler...", new Date().toISOString());
        try {
            await sendDueDateReminders();
            await autoTransitionExpiredRfqs();
            await autoAwardFromPO();
        } catch (err) {
            console.error("[CRON] RFQ scheduler error:", err);
        }
    });

    console.log("[CRON] RFQ scheduler registered (runs daily at 9:00 AM)");
}

/**
 * 1) Due-date reminders: for RFQs in ACCEPTING_RESPONSE whose dueDate
 *    is within the next 7 days, create one notification per day.
 */
async function sendDueDateReminders(): Promise<void> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);

    // Find RFQs due within the next 7 days that are still accepting responses
    const rfqs = await RFQ.find({
        isDeleted: false,
        status: { $in: ["ACCEPTING_RESPONSE", "PREVIEW"] },
        dueDate: { $gte: today, $lte: in7Days },
    }).lean();

    for (const rfq of rfqs) {
        // Check if we already sent a reminder today for this RFQ
        const startOfDay = new Date(today);
        const endOfDay = new Date(today);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const existing = await Notification.findOne({
            rfq: rfq._id,
            type: "DUE_DATE_REMINDER",
            createdAt: { $gte: startOfDay, $lt: endOfDay },
        });

        if (existing) continue;

        const dueDate = new Date(rfq.dueDate);
        const diffMs = dueDate.getTime() - today.getTime();
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        const message =
            daysLeft === 0
                ? `RFQ ${rfq.prNumber} (${rfq.companyName}) is due today!`
                : daysLeft === 1
                  ? `RFQ ${rfq.prNumber} (${rfq.companyName}) is due tomorrow!`
                  : `RFQ ${rfq.prNumber} (${rfq.companyName}) is due in ${daysLeft} days`;

        await Notification.create({
            message,
            type: "DUE_DATE_REMINDER",
            rfq: rfq._id,
            prNumber: rfq.prNumber,
        });

        console.log(`[CRON] Reminder: ${message}`);
    }
}

/**
 * 2) Auto-transition: RFQs in ACCEPTING_RESPONSE whose dueDate has
 *    passed are moved to PENDING_SELECTION.
 */
async function autoTransitionExpiredRfqs(): Promise<void> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const expiredRfqs = await RFQ.find({
        isDeleted: false,
        status: { $in: ["ACCEPTING_RESPONSE", "PREVIEW"] },
        dueDate: { $lt: today },
    });

    for (const rfq of expiredRfqs) {
        rfq.status = "PENDING_SELECTION";
        await rfq.save();

        // Check if we already created a status-change notification for this
        const existing = await Notification.findOne({
            rfq: rfq._id,
            type: "STATUS_CHANGE",
            message: { $regex: "PENDING_SELECTION" },
        });

        if (!existing) {
            await Notification.create({
                message: `RFQ ${rfq.prNumber} (${rfq.companyName}) due date passed — status changed to PENDING_SELECTION`,
                type: "STATUS_CHANGE",
                rfq: rfq._id,
                prNumber: rfq.prNumber,
            });
        }

        console.log(`[CRON] Auto-transitioned RFQ ${rfq.prNumber} → PENDING_SELECTION`);
    }
}

/**
 * 3) Auto-award: RFQs in PENDING_SELECTION whose prNumber matches
 *    an existing PO Register entry are moved to AWARDED.
 */
async function autoAwardFromPO(): Promise<void> {
    const pendingRfqs = await RFQ.find({
        isDeleted: false,
        status: "PENDING_SELECTION",
    }).lean();

    if (pendingRfqs.length === 0) return;

    // Collect all PR numbers from pending RFQs
    const prNumbers = pendingRfqs.map(r => r.prNumber);

    // Find PO Register entries that match these PR numbers
    const matchingPOs = await PORegister.find({
        isDeleted: false,
        prNumber: { $in: prNumbers },
    })
        .select("prNumber")
        .lean();

    const matchedPrNumbers = new Set(matchingPOs.map(po => po.prNumber).filter(Boolean));

    for (const rfq of pendingRfqs) {
        if (!matchedPrNumbers.has(rfq.prNumber)) continue;

        await RFQ.findByIdAndUpdate(rfq._id, { status: "AWARDED" });

        // Check if we already created an award notification
        const existing = await Notification.findOne({
            rfq: rfq._id,
            type: "ORDER_AWARDED",
        });

        if (!existing) {
            await Notification.create({
                message: `RFQ ${rfq.prNumber} (${rfq.companyName}) has been AWARDED — matching PO found`,
                type: "ORDER_AWARDED",
                rfq: rfq._id,
                prNumber: rfq.prNumber,
            });
        }

        console.log(`[CRON] Auto-awarded RFQ ${rfq.prNumber}`);
    }
}
