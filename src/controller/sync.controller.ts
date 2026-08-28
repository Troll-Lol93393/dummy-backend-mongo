import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import { Item } from "../models/item.model";
import { Client } from "../models/client.model";
import { Party } from "../models/party.model";
import { Sales } from "../models/sales.model";
import { Purchase } from "../models/purchase.model";

// Receiving side for the jow-legacy-sync agent. The agent already did the
// content-hash diffing on its side - it only sends what's actually new or
// changed - so this layer's job is just idempotent upsert + soft-delete,
// same as the existing file-upload imports (see sales.controller.ts).
const BULK_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
}

function requireRecords(req: Request): Record<string, unknown>[] {
    const records = req.body?.records;
    if (!Array.isArray(records)) throw new ApiError(400, "Expected { records: [...] } in request body");
    return records;
}

function requireDeleteKeys(req: Request): string[] {
    const records = req.body?.records;
    if (!Array.isArray(records)) throw new ApiError(400, "Expected { records: [{ naturalKey }] } in request body");
    return records.map((r: { naturalKey: string }) => r.naturalKey);
}

export const syncItems = asyncHandler(async (req: Request, res: Response) => {
    const records = requireRecords(req);
    let upsertedCount = 0;
    let modifiedCount = 0;

    for (const batch of chunk(records, BULK_CHUNK_SIZE)) {
        const ops = batch.map(record => ({
            updateOne: {
                filter: { itemCode: record.itemCode },
                update: { $set: { ...record, isDeleted: false } },
                upsert: true,
            },
        }));
        const result = await Item.bulkWrite(ops, { ordered: false });
        upsertedCount += result.upsertedCount;
        modifiedCount += result.modifiedCount;
    }

    res.status(200).json(new ApiResponse(200, { upsertedCount, modifiedCount }, "Items synced"));
});

export const syncDeleteItems = asyncHandler(async (req: Request, res: Response) => {
    const itemCodes = requireDeleteKeys(req);
    const result = await Item.updateMany(
        { itemCode: { $in: itemCodes } },
        { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    res.status(200).json(new ApiResponse(200, { deletedCount: result.modifiedCount }, "Items marked deleted"));
});

// Matches by legacyCode first (set by a prior sync run), falling back to
// companyName so a client already created manually (e.g. via Excel import,
// which has no legacyCode) gets merged with instead of duplicated.
export const syncClients = asyncHandler(async (req: Request, res: Response) => {
    const records = requireRecords(req);

    let upsertedCount = 0;
    let modifiedCount = 0;

    // Safety: remove duplicate legacy codes within the same request
    const uniqueRecords = Array.from(
        new Map(
            records.map(record => [
                String(record.legacyCode),
                record
            ])
        ).values()
    );

    for (const batch of chunk(uniqueRecords, BULK_CHUNK_SIZE)) {
        const ops = batch.map(record => ({
            updateOne: {
                // IMPORTANT:
                // Always match a legacy sync record by legacyCode only.
                filter: {
                    legacyCode: String(record.legacyCode)
                },

                update: {
                    $set: {
                        ...record,
                        legacyCode: String(record.legacyCode),
                        isDeleted: false
                    }
                },

                upsert: true
            }
        }));

        const result = await Client.bulkWrite(ops, {
            ordered: false
        });

        upsertedCount += result.upsertedCount;
        modifiedCount += result.modifiedCount;
    }

    res.status(200).json(
        new ApiResponse(
            200,
            {
                upsertedCount,
                modifiedCount
            },
            "Clients synced"
        )
    );
});

export const syncDeleteClients = asyncHandler(async (req: Request, res: Response) => {
    const legacyCodes = requireDeleteKeys(req);
    const result = await Client.updateMany(
        { legacyCode: { $in: legacyCodes } },
        { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    res.status(200).json(new ApiResponse(200, { deletedCount: result.modifiedCount }, "Clients marked deleted"));
});

// GSTIN is the preferred match (see party.model.ts's unique sparse index);
// legacyCode is the fallback when a vendor has no GSTIN on file.
export const syncParties = asyncHandler(async (req: Request, res: Response) => {
    const records = requireRecords(req);
    let upsertedCount = 0;
    let modifiedCount = 0;

    for (const batch of chunk(records, BULK_CHUNK_SIZE)) {
        const ops = batch.map(record => {
            const orClauses: Record<string, unknown>[] = [{ legacyCode: record.legacyCode }];
            if (record.gstin) orClauses.unshift({ gstin: record.gstin });
            return {
                updateOne: {
                    filter: { $or: orClauses },
                    update: { $set: { ...record, isDeleted: false } },
                    upsert: true,
                },
            };
        });
        const result = await Party.bulkWrite(ops, { ordered: false });
        upsertedCount += result.upsertedCount;
        modifiedCount += result.modifiedCount;
    }

    res.status(200).json(new ApiResponse(200, { upsertedCount, modifiedCount }, "Parties synced"));
});

export const syncDeleteParties = asyncHandler(async (req: Request, res: Response) => {
    const legacyCodes = requireDeleteKeys(req);
    const result = await Party.updateMany(
        { legacyCode: { $in: legacyCodes } },
        { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    res.status(200).json(new ApiResponse(200, { deletedCount: result.modifiedCount }, "Parties marked deleted"));
});

export const syncSales = asyncHandler(async (req: Request, res: Response) => {
    const records = requireRecords(req);
    const itemCodes = [...new Set(records.map(r => r.itemCode as string))];
    const items = itemCodes.length
        ? await Item.find({ itemCode: { $in: itemCodes }, isDeleted: false }).select("_id itemCode").lean()
        : [];
    const itemMap = new Map(items.map(i => [i.itemCode, i._id]));

    let upsertedCount = 0;
    let modifiedCount = 0;

    for (const batch of chunk(records, BULK_CHUNK_SIZE)) {
        const ops = batch.map(record => ({
            updateOne: {
                filter: { invoiceNumber: record.invoiceNumber, serialNumber: record.serialNumber },
                update: {
                    $set: {
                        ...record,
                        item: itemMap.get(record.itemCode as string),
                        status: record.cancelDate ? "CANCELLED" : "DISPATCHED",
                        isDeleted: false,
                    },
                },
                upsert: true,
            },
        }));
        const result = await Sales.bulkWrite(ops, { ordered: false });
        upsertedCount += result.upsertedCount;
        modifiedCount += result.modifiedCount;
    }

    res.status(200).json(new ApiResponse(200, { upsertedCount, modifiedCount }, "Sales synced"));
});

export const syncDeleteSales = asyncHandler(async (req: Request, res: Response) => {
    const keys = requireDeleteKeys(req); // "invoiceNumber:serialNumber"
    let deletedCount = 0;
    for (const key of keys) {
        const [invoiceNumber, serialNumberStr] = key.split(":");
        const result = await Sales.updateOne(
            { invoiceNumber, serialNumber: Number(serialNumberStr) },
            { $set: { isDeleted: true, deletedAt: new Date() } }
        );
        deletedCount += result.modifiedCount;
    }
    res.status(200).json(new ApiResponse(200, { deletedCount }, "Sales marked deleted"));
});

export const syncPurchases = asyncHandler(async (req: Request, res: Response) => {
    const records = requireRecords(req);

    const itemCodes = [...new Set(records.map(r => r.itemCode as string))];
    const vendorCodes = [...new Set(records.map(r => r.vendorLegacyCode as string).filter(Boolean))];

    const [items, vendors] = await Promise.all([
        itemCodes.length
            ? Item.find({ itemCode: { $in: itemCodes }, isDeleted: false }).select("_id itemCode").lean()
            : Promise.resolve([]),
        vendorCodes.length
            ? Party.find({ legacyCode: { $in: vendorCodes }, isDeleted: false }).select("_id legacyCode").lean()
            : Promise.resolve([]),
    ]);

    const itemMap = new Map(items.map(i => [i.itemCode, i._id]));
    const vendorMap = new Map(vendors.map(v => [v.legacyCode, v._id]));

    let upsertedCount = 0;
    let modifiedCount = 0;

    for (const batch of chunk(records, BULK_CHUNK_SIZE)) {
        const ops = batch.map(record => {
            const { vendorLegacyCode, ...rest } = record as { vendorLegacyCode?: string };
            return {
                updateOne: {
                    filter: { legacyContra: record.legacyContra, legacySrno: record.legacySrno },
                    update: {
                        $set: {
                            ...rest,
                            item: itemMap.get(record.itemCode as string),
                            vendor: vendorLegacyCode ? vendorMap.get(vendorLegacyCode) : undefined,
                            isDeleted: false,
                        },
                    },
                    upsert: true,
                },
            };
        });
        const result = await Purchase.bulkWrite(ops, { ordered: false });
        upsertedCount += result.upsertedCount;
        modifiedCount += result.modifiedCount;
    }

    res.status(200).json(new ApiResponse(200, { upsertedCount, modifiedCount }, "Purchases synced"));
});

export const syncDeletePurchases = asyncHandler(async (req: Request, res: Response) => {
    const keys = requireDeleteKeys(req); // "legacyContra:legacySrno"
    let deletedCount = 0;
    for (const key of keys) {
        const [contraStr, srnoStr] = key.split(":");
        const result = await Purchase.updateOne(
            { legacyContra: Number(contraStr), legacySrno: Number(srnoStr) },
            { $set: { isDeleted: true, deletedAt: new Date() } }
        );
        deletedCount += result.modifiedCount;
    }
    res.status(200).json(new ApiResponse(200, { deletedCount }, "Purchases marked deleted"));
});
