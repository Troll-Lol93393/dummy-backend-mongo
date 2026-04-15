import { RFQ } from "../../models/rfq.models";
import { RFQItems } from "../../models/rfqItems.model";
import { logger } from "../../utils/logger";

type DrawingEntry = {
    url: string;
    filename: string;
};

type ItemRef = {
    _id: string;
    itemCode?: string;
    drawingNumber?: string;
    drawingUrl?: string;
};

type MatchReason = "ITEM_CODE" | "DRAWING_NUMBER";

type MatchResult = {
    matchedItemId: string;
    reason: MatchReason;
};

const splitPattern = /[\s._\-\\/|()[\]{}]+/g;

const normalize = (value: string): string =>
    value
        .toUpperCase()
        .replace(/\.[A-Z0-9]+$/i, "")
        .trim();

const tokenize = (value: string): string[] =>
    normalize(value)
        .split(splitPattern)
        .map(t => t.trim())
        .filter(Boolean);

const normalizeDrawingNumber = (value: string): string => {
    const clean = normalize(value).replace(/[^A-Z0-9/]/g, "");
    const segments = clean.split("/").filter(Boolean);
    return segments.join("/");
};

const getTrailingWindow = (segments: string[], maxParts = 4): string[] => {
    const out: string[] = [];
    for (let i = 1; i <= Math.min(maxParts, segments.length); i++) {
        out.push(segments.slice(-i).join("/"));
    }
    return out;
};

function findMatch(filename: string, items: ItemRef[]): MatchResult | null {
    const normalizedFile = normalize(filename);
    const fileTokens = tokenize(filename);

    const codeMatches = items.filter(item => {
        const code = normalize(item.itemCode || "");
        if (!code) return false;
        return (
            normalizedFile.includes(code) ||
            fileTokens.includes(code)
        );
    });

    if (codeMatches.length === 1 && codeMatches[0]) {
        return { matchedItemId: codeMatches[0]._id, reason: "ITEM_CODE" };
    }

    if (codeMatches.length > 1) {
        return null;
    }

    const drawingMatches = items.filter(item => {
        const drawingNumber = normalizeDrawingNumber(item.drawingNumber || "");
        if (!drawingNumber) return false;

        const drawingSegments = drawingNumber.split("/").filter(Boolean);
        if (drawingSegments.length === 0) return false;

        const trailingCandidates = getTrailingWindow(drawingSegments);
        return trailingCandidates.some(candidate => normalizedFile.includes(candidate));
    });

    if (drawingMatches.length === 1 && drawingMatches[0]) {
        return { matchedItemId: drawingMatches[0]._id, reason: "DRAWING_NUMBER" };
    }

    return null;
}

export async function autoMapRfqDrawingsToItems(rfqId: string): Promise<void> {
    const rfq = await RFQ.findOne({ _id: rfqId, isDeleted: false }).populate({
        path: "items",
        match: { isDeleted: false },
        populate: [{ path: "item", select: "itemCode" }],
    });

    if (!rfq) {
        logger.warn("RFQ_DRAWING_MAP", `RFQ not found for mapping: ${rfqId}`);
        return;
    }

    const drawings = (rfq.drawings || []).filter(d => Boolean(d?.url && d?.filename)) as DrawingEntry[];
    if (drawings.length === 0) return;

    const itemDocs = (rfq.items || []) as unknown as Array<{
        _id: { toString: () => string };
        item?: { itemCode?: string };
        drawingNumber?: string;
        drawingUrl?: string;
    }>;

    const items: ItemRef[] = itemDocs.map(doc => ({
        _id: doc._id.toString(),
        itemCode: doc.item?.itemCode || "",
        drawingNumber: doc.drawingNumber || "",
        drawingUrl: doc.drawingUrl || "",
    }));

    if (items.length === 0) return;

    let matchedByItemCode = 0;
    let matchedByDrawingNumber = 0;
    let unmatched = 0;
    let skippedExisting = 0;
    let ambiguous = 0;

    for (const drawing of drawings) {
        const match = findMatch(drawing.filename, items);
        if (!match) {
            const hadPossibleCandidates = items.some(item => {
                const code = normalize(item.itemCode || "");
                return code && normalize(drawing.filename).includes(code);
            });
            if (hadPossibleCandidates) ambiguous++;
            else unmatched++;
            continue;
        }

        const targetItem = items.find(i => i._id === match.matchedItemId);
        if (!targetItem) {
            unmatched++;
            continue;
        }

        if (targetItem.drawingUrl) {
            skippedExisting++;
            continue;
        }

        await RFQItems.findByIdAndUpdate(targetItem._id, {
            $set: { drawingUrl: drawing.url },
        });
        targetItem.drawingUrl = drawing.url;

        if (match.reason === "ITEM_CODE") matchedByItemCode++;
        if (match.reason === "DRAWING_NUMBER") matchedByDrawingNumber++;
    }

    logger.info("RFQ_DRAWING_MAP", `Drawing mapping completed for RFQ ${rfq.prNumber}`, {
        rfqId: String(rfq._id),
        totalDrawings: drawings.length,
        matchedByItemCode,
        matchedByDrawingNumber,
        unmatched,
        ambiguous,
        skippedExisting,
    });
}
