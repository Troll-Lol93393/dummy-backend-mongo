import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import { RFQItems } from "../models/rfqItems.model";
import { RFQ } from "../models/rfq.models";
import { Costing } from "../models/costing.model";
import { PORegister } from "../models/poRegister.model";

export const getItemHistory = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const itemCode = req.params.itemCode;

        if (!itemCode || itemCode.trim() === "") {
            throw new ApiError(400, "Item code is required");
        }

        // ── 1. Quotation History ──
        // Find all RFQ items that reference this item (via populated item.itemCode)
        const rfqItems = await RFQItems.find({ isDeleted: false })
            .populate({
                path: "item",
                match: { itemCode: itemCode },
                select: "itemCode itemName",
            })
            .lean();

        // Filter to only those where the populated item matched
        const matchedRfqItems = rfqItems.filter(ri => ri.item !== null);

        const quotationHistory: {
            rfqId: string;
            rfqItemId: string;
            prNumber: string;
            companyName: string;
            quotationNumber: number | null;
            quotedOn: string | null;
            isRevised: boolean;
            revisionDate: string | null;
            sellingPrice: number;
            totalCost: number;
            quantity: number;
        }[] = [];

        if (matchedRfqItems.length > 0) {
            const rfqItemIds = matchedRfqItems.map(ri => ri._id);

            // Find all RFQs that contain these rfqItems
            const rfqs = await RFQ.find({
                items: { $in: rfqItemIds },
                isDeleted: false,
            })
                .select(
                    "prNumber companyName quotationNumber quotedOn isRevised revisionDate items"
                )
                .lean();

            // Build rfqItem → RFQ lookup
            const rfqItemToRfq = new Map<
                string,
                {
                    rfqId: string;
                    prNumber: string;
                    companyName: string;
                    quotationNumber: number | null;
                    quotedOn: string | null;
                    isRevised: boolean;
                    revisionDate: string | null;
                }
            >();
            for (const rfq of rfqs) {
                for (const itemRef of rfq.items) {
                    rfqItemToRfq.set(String(itemRef), {
                        rfqId: String(rfq._id),
                        prNumber: rfq.prNumber,
                        companyName: rfq.companyName,
                        quotationNumber:
                            rfq.quotationNumber !== undefined ? rfq.quotationNumber : null,
                        quotedOn: rfq.quotedOn ? rfq.quotedOn.toISOString() : null,
                        isRevised: rfq.isRevised,
                        revisionDate: rfq.revisionDate ? rfq.revisionDate.toISOString() : null,
                    });
                }
            }

            // Fetch costings for these rfqItems
            const costings = await Costing.find({
                rfqItem: { $in: rfqItemIds },
                isDeleted: false,
            })
                .select("rfqItem sellingPrice totalCost")
                .lean();

            const costingMap = new Map<string, { sellingPrice: number; totalCost: number }>();
            for (const c of costings) {
                costingMap.set(String(c.rfqItem), {
                    sellingPrice: c.sellingPrice,
                    totalCost: c.totalCost,
                });
            }

            for (const ri of matchedRfqItems) {
                const rfqInfo = rfqItemToRfq.get(String(ri._id));
                const costingInfo = costingMap.get(String(ri._id));

                if (rfqInfo) {
                    quotationHistory.push({
                        rfqId: rfqInfo.rfqId,
                        rfqItemId: String(ri._id),
                        prNumber: rfqInfo.prNumber,
                        companyName: rfqInfo.companyName,
                        quotationNumber: rfqInfo.quotationNumber,
                        quotedOn: rfqInfo.quotedOn,
                        isRevised: rfqInfo.isRevised,
                        revisionDate: rfqInfo.revisionDate,
                        sellingPrice: costingInfo?.sellingPrice ?? 0,
                        totalCost: costingInfo?.totalCost ?? 0,
                        quantity: ri.quantity,
                    });
                }
            }
        }

        // ── 2. PO / Sale History ──
        const poRegisters = await PORegister.find({
            "items.itemCode": {
                $regex: `^${itemCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                $options: "i",
            },
            isDeleted: false,
        })
            .select("jobNumber poNumber poDate companyName items")
            .sort({ poDate: -1 })
            .lean();

        const saleHistory: {
            poId: string;
            jobNumber: string;
            poNumber: string;
            poDate: string | null;
            companyName: string;
            rate: number;
            quantity: number;
            basicValue: number;
        }[] = [];

        for (const po of poRegisters) {
            const matchingItems = po.items.filter(
                (item: { itemCode: string }) =>
                    item.itemCode.toLowerCase() === itemCode.toLowerCase()
            );
            for (const item of matchingItems) {
                saleHistory.push({
                    poId: String(po._id),
                    jobNumber: po.jobNumber,
                    poNumber: po.poNumber,
                    poDate: po.poDate ? po.poDate.toISOString() : null,
                    companyName: po.companyName,
                    rate: item.rate,
                    quantity: item.quantity,
                    basicValue: item.basicValue,
                });
            }
        }

        // Sort quotation history by quotedOn desc
        quotationHistory.sort((a, b) => {
            const dateA = a.quotedOn ? new Date(a.quotedOn).getTime() : 0;
            const dateB = b.quotedOn ? new Date(b.quotedOn).getTime() : 0;
            return dateB - dateA;
        });

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    itemCode,
                    quotationHistory,
                    saleHistory,
                },
                "Item history fetched successfully"
            )
        );
    }
);
