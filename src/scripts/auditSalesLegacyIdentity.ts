import "dotenv/config";
import mongoose from "mongoose";
import { Sales } from "../models/sales.model";
import { DB_NAME } from "../constants";

/** Read-only audit; it never updates documents or indexes. */
async function run(): Promise<void> {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGODB_URI is required");
    await mongoose.connect(`${mongoUri}/${DB_NAME}`);

    const collection = Sales.collection;
    const [indexes, summary, reusedInvoiceLines] = await Promise.all([
        collection.indexes(),
        collection.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ["$isDeleted", false] }, 1, 0] } },
                    withLegacyIdentity: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $ne: [{ $type: "$legacyContra" }, "missing"] },
                                        { $ne: [{ $type: "$legacySrno" }, "missing"] },
                                    ],
                                }, 1, 0,
                            ],
                        },
                    },
                },
            },
        ]).toArray(),
        collection.aggregate([
            { $match: { isDeleted: false } },
            { $group: { _id: { invoiceNumber: "$invoiceNumber", serialNumber: "$serialNumber" }, contraValues: { $addToSet: "$legacySource.contra" } } },
            { $match: { "contraValues.1": { $exists: true } } },
            { $count: "reusedInvoiceLinePairs" },
        ]).toArray(),
    ]);

    console.log(JSON.stringify({ indexes, summary: summary[0] ?? null, reusedInvoiceLines: reusedInvoiceLines[0]?.reusedInvoiceLinePairs ?? 0 }, null, 2));
}

run().finally(() => mongoose.disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
