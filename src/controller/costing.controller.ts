import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import fs from "fs";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { uploadFileToCloudinary } from "../utils/cloudinary";
import { Costing } from "../models/costing.model";
import { RFQItems } from "../models/rfqItems.model";
import { RFQ } from "../models/rfq.models";
import { CommercialSpecs } from "../models/item.commercial.model";
import { generateCostingSheetPdf, CostingSheetData } from "../services/costingSheet/generatePdf";
import { generateCostingSheetExcel } from "../services/costingSheet/generateExcel";
import { getCompanyProfileForGenerators } from "./companyProfile.controller";
import { fetchLogoBuffer } from "../services/shared/fetchLogo";

// Round to nearest multiple of 5
const roundTo5 = (n: number): number => Math.round(n / 5) * 5;

export const createOrUpdateCosting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;

        if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
            throw new ApiError(400, "Invalid RFQ Item ID");
        }

        const rfqItem = await RFQItems.findOne({ _id: rfqItemId, isDeleted: false });
        if (!rfqItem) {
            throw new ApiError(404, "RFQ Item not found");
        }

        const rfq = await RFQ.findOne({ items: rfqItemId, isDeleted: false });
        if (!rfq) {
            throw new ApiError(404, "RFQ not found for this item");
        }

        const { parts = [], packingCost = 0, shippingCost = 0, otherCosts = 0 } = req.body;

        if (!Array.isArray(parts) || parts.length === 0) {
            throw new ApiError(400, "At least one part is required");
        }

        // Process each part
        const processedParts = parts.map((part: any) => {
            const supplyType = part.supplyType ?? "MANUAL";
            const partQuantity = part.quantity ?? 1;
            const profitMargin = part.profitMargin ?? 0;

            if (supplyType === "COMPLETE_SUPPLY") {
                // Complete supply: costPrice = rate * quantity
                const rate = part.completeSupplyRate ?? 0;
                const costPrice = roundTo5(rate * partQuantity);
                const profitAmount = (costPrice * profitMargin) / 100;
                const partTotal = roundTo5(costPrice + profitAmount);

                return {
                    partName: part.partName ?? "Part",
                    quantity: partQuantity,
                    supplyType,
                    diameter: 0,
                    length: 0,
                    density: 0,
                    weight: 0,
                    materialRate: 0,
                    rawMaterialCost: 0,
                    labourEntries: [],
                    totalLabourCost: 0,
                    completeSupplyRate: rate,
                    completeSupplyParty: part.completeSupplyParty
                        ? new mongoose.Types.ObjectId(part.completeSupplyParty as string)
                        : undefined,
                    completeSupplyDate: part.completeSupplyDate
                        ? new Date(part.completeSupplyDate)
                        : undefined,
                    completeSupplyProofDocumentUrl: part.completeSupplyProofDocumentUrl ?? "",
                    costPrice,
                    profitMargin,
                    profitAmount,
                    partTotal,
                };
            }

            // MANUAL costing
            const shapeType = part.shapeType ?? "ROUND";
            const diameter = part.diameter ?? 0;
            const width = part.width ?? 0;
            const thickness = part.thickness ?? 0;
            const innerDiameter = part.innerDiameter ?? 0;
            const length = part.length ?? 0;
            const density = part.density ?? 7.85;
            const materialRate = part.materialRate ?? 0;

            // Weight calculation based on shape (all dims in mm, density in g/cm³)
            // Volume in mm³ → divide by 1,000,000 to get kg (density g/cm³ = kg/dm³)
            let volume = 0;
            switch (shapeType) {
                case "ROUND":
                    volume = Math.PI * Math.pow(diameter / 2, 2) * length;
                    break;
                case "SQUARE":
                    volume = Math.pow(width, 2) * length;
                    break;
                case "FLAT":
                    volume = width * thickness * length;
                    break;
                case "HEX":
                    // Regular hexagon: area = (√3/2) × s² where s = across-flats
                    volume = (Math.sqrt(3) / 2) * Math.pow(diameter, 2) * length;
                    break;
                case "PIPE":
                    volume =
                        Math.PI *
                        (Math.pow(diameter / 2, 2) - Math.pow(innerDiameter / 2, 2)) *
                        length;
                    break;
                case "SHEET":
                    volume = width * length * thickness;
                    break;
                default:
                    volume = Math.PI * Math.pow(diameter / 2, 2) * length;
            }
            const weight = (volume * density) / 1000000;

            // Raw material cost for this part (rate * weight * quantity)
            const rawMaterialCost = roundTo5(weight * materialRate * partQuantity);

            // Labour costs for this part
            const processedLabourEntries = (part.labourEntries ?? []).map((entry: any) => ({
                ...entry,
                labourProcessType: entry.labourProcessType,
                party: entry.party || undefined,
                cost: entry.rateType === "PER_KG" ? entry.rate * weight : entry.rate,
                proofDocumentUrl: entry.proofDocumentUrl ?? "",
            }));
            const totalLabourCost = processedLabourEntries.reduce(
                (sum: number, e: any) => sum + ((e.cost as number) ?? 0),
                0
            );
            // Labour cost scaled by part quantity
            const totalLabourCostForPart = roundTo5(totalLabourCost * partQuantity);

            // Part-level pricing
            const costPrice = roundTo5(rawMaterialCost + totalLabourCostForPart);
            const profitAmount = (costPrice * profitMargin) / 100;
            const partTotal = roundTo5(costPrice + profitAmount);

            return {
                partName: part.partName ?? "Part",
                quantity: partQuantity,
                supplyType,
                shapeType,
                diameter,
                width,
                thickness,
                innerDiameter,
                length,
                density,
                weight,
                materialRate,
                rawMaterialParty: part.rawMaterialParty
                    ? new mongoose.Types.ObjectId(part.rawMaterialParty as string)
                    : undefined,
                rawMaterialCost,
                rawMaterialProofDocumentUrl: part.rawMaterialProofDocumentUrl ?? "",
                labourEntries: processedLabourEntries,
                totalLabourCost: totalLabourCostForPart,
                completeSupplyRate: 0,
                costPrice,
                profitMargin,
                profitAmount,
                partTotal,
            };
        });

        // Aggregate totals
        const totalPartsCost = processedParts.reduce((sum: number, p: any) => sum + p.partTotal, 0);
        const sellingPrice = roundTo5(totalPartsCost + packingCost + shippingCost + otherCosts);
        const totalCost = roundTo5(sellingPrice * (rfqItem.quantity ?? 1));

        const costingData = {
            rfqItem: new mongoose.Types.ObjectId(rfqItemId),
            rfq: rfq._id,
            parts: processedParts,
            totalPartsCost,
            packingCost,
            shippingCost,
            otherCosts,
            sellingPrice,
            totalCost,
        };

        const costing = await Costing.findOneAndUpdate(
            { rfqItem: rfqItemId, isDeleted: false },
            { $set: costingData },
            { upsert: true, new: true }
        );

        // Sync to CommercialSpecs
        if (rfqItem.commercialSpecs) {
            const totalRawMaterialCost = processedParts.reduce(
                (sum: number, p: any) =>
                    sum +
                    (p.supplyType === "COMPLETE_SUPPLY"
                        ? p.completeSupplyRate * p.quantity
                        : p.rawMaterialCost),
                0
            );
            const totalLabourCost = processedParts.reduce(
                (sum: number, p: any) => sum + (p.totalLabourCost ?? 0),
                0
            );
            const totalProfitAmount = processedParts.reduce(
                (sum: number, p: any) => sum + (p.profitAmount ?? 0),
                0
            );
            await CommercialSpecs.findByIdAndUpdate(rfqItem.commercialSpecs, {
                $set: {
                    rawMaterialCost: totalRawMaterialCost,
                    laborCost: totalLabourCost,
                    profitMargin: totalProfitAmount,
                    packingCost,
                    shippingCost,
                    otherCosts,
                    sellingPrice,
                    totalCost,
                },
            });
        }

        res.status(200).json(new ApiResponse(200, costing, "Costing saved successfully"));
    }
);

export const getCosting = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqItemId } = req.params;

    if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
        throw new ApiError(400, "Invalid RFQ Item ID");
    }

    const costing = await Costing.findOne({
        rfqItem: rfqItemId,
        isDeleted: false,
    })
        .populate("parts.rawMaterialParty", "acName")
        .populate("parts.completeSupplyParty", "acName")
        .populate("parts.labourEntries.labourProcessType", "name")
        .populate("parts.labourEntries.party", "acName");

    if (!costing) {
        throw new ApiError(404, "Costing not found for this RFQ item");
    }

    res.status(200).json(new ApiResponse(200, costing, "Costing fetched successfully"));
});

export const getCostingsByRfq = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqId } = req.params;

        if (!rfqId || !mongoose.Types.ObjectId.isValid(rfqId)) {
            throw new ApiError(400, "Invalid RFQ ID");
        }

        const costings = await Costing.find({
            rfq: rfqId,
            isDeleted: false,
        })
            .populate({
                path: "rfqItem",
                populate: { path: "item" },
            })
            .populate("parts.rawMaterialParty", "acName")
            .populate("parts.completeSupplyParty", "acName")
            .populate("parts.labourEntries.labourProcessType", "name")
            .populate("parts.labourEntries.party", "acName");

        res.status(200).json(new ApiResponse(200, costings, "Costings fetched successfully"));
    }
);

export const deleteCosting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;

        if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
            throw new ApiError(400, "Invalid RFQ Item ID");
        }

        const costing = await Costing.findOneAndUpdate(
            { rfqItem: rfqItemId, isDeleted: false },
            { isDeleted: true },
            { new: true }
        );

        if (!costing) {
            throw new ApiError(404, "Costing not found for this RFQ item");
        }

        res.status(200).json(new ApiResponse(200, costing, "Costing deleted successfully"));
    }
);

export const cloneCosting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { rfqItemId } = req.params;
        const { sourceCostingId } = req.body;

        if (!rfqItemId || !mongoose.Types.ObjectId.isValid(rfqItemId)) {
            throw new ApiError(400, "Invalid RFQ Item ID");
        }
        if (!sourceCostingId || !mongoose.Types.ObjectId.isValid(sourceCostingId)) {
            throw new ApiError(400, "Invalid source costing ID");
        }

        const rfqItem = await RFQItems.findOne({ _id: rfqItemId, isDeleted: false });
        if (!rfqItem) {
            throw new ApiError(404, "RFQ Item not found");
        }

        const rfq = await RFQ.findOne({ items: rfqItemId, isDeleted: false });
        if (!rfq) {
            throw new ApiError(404, "RFQ not found for this item");
        }

        const source = await Costing.findOne({ _id: sourceCostingId, isDeleted: false });
        if (!source) {
            throw new ApiError(404, "Source costing not found");
        }

        // Clone parts (strip _id from subdocs), keep rates and structure
        const clonedParts = source.parts.map(p => {
            const part = (p as any).toObject ? (p as any).toObject() : { ...p };
            delete (part as any)._id;
            part.labourEntries = part.labourEntries.map((e: any) => {
                const entry = { ...e };
                delete entry._id;
                return entry;
            });
            return part;
        });

        const costingData = {
            rfqItem: new mongoose.Types.ObjectId(rfqItemId),
            rfq: rfq._id,
            parts: clonedParts,
            totalPartsCost: source.totalPartsCost,
            packingCost: source.packingCost,
            shippingCost: source.shippingCost,
            otherCosts: source.otherCosts,
            sellingPrice: source.sellingPrice,
            totalCost: source.sellingPrice * (rfqItem.quantity ?? 1),
        };

        const costing = await Costing.findOneAndUpdate(
            { rfqItem: rfqItemId, isDeleted: false },
            { $set: costingData },
            { upsert: true, new: true }
        );

        res.status(200).json(new ApiResponse(200, costing, "Costing cloned successfully"));
    }
);

export const searchCostingsForClone = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { q } = req.query;
        const searchTerm = ((q as string) || "").trim();

        if (!searchTerm) {
            throw new ApiError(400, "Search query is required");
        }

        const costings = await Costing.find({ isDeleted: false })
            .populate({
                path: "rfqItem",
                match: { isDeleted: false },
                populate: { path: "item" },
            })
            .populate({
                path: "rfq",
                select: "prNumber companyName",
            })
            .limit(20)
            .lean();

        // Filter by item name/code or PR number matching the search term
        const regex = new RegExp(searchTerm, "i");
        const filtered = costings.filter(c => {
            const rfqItem = c.rfqItem as any;
            const rfq = c.rfq as any;
            if (!rfqItem) return false;
            return (
                regex.test(rfqItem.item?.itemName ?? "") ||
                regex.test(rfqItem.item?.itemCode ?? "") ||
                regex.test(rfq?.prNumber ?? "")
            );
        });

        res.status(200).json(new ApiResponse(200, filtered, "Costings fetched for cloning"));
    }
);

// ── Costing Sheet helpers ──

async function buildCostingSheetData(rfqId: string): Promise<CostingSheetData> {
    const rfq = await RFQ.findById(rfqId).lean();
    if (!rfq) throw new ApiError(404, "RFQ not found");

    const costings = await Costing.find({ rfq: rfqId, isDeleted: false })
        .populate({
            path: "rfqItem",
            populate: { path: "item" },
        })
        .populate("parts.rawMaterialParty", "acName")
        .populate("parts.completeSupplyParty", "acName")
        .populate("parts.labourEntries.labourProcessType", "name")
        .populate("parts.labourEntries.party", "acName")
        .lean();

    const items = costings
        .filter(c => c.rfqItem)
        .map(c => {
            const rfqItem = c.rfqItem as any;
            const item = rfqItem?.item ?? {};
            return {
                serialNumber: rfqItem?.serialNumber ?? "",
                itemCode: item.itemCode ?? "",
                itemName: item.itemName ?? "",
                itemType: item.itemType ?? "UNIT",
                quantity: rfqItem?.quantity ?? 1,
                parts: (c.parts ?? []).map(p => ({
                    partName: p.partName,
                    quantity: p.quantity,
                    supplyType: p.supplyType as "MANUAL" | "COMPLETE_SUPPLY",
                    shapeType: p.shapeType,
                    diameter: p.diameter,
                    width: p.width,
                    thickness: p.thickness,
                    innerDiameter: p.innerDiameter,
                    length: p.length,
                    density: p.density,
                    weight: p.weight,
                    materialRate: p.materialRate,
                    rawMaterialParty: p.rawMaterialParty as any,
                    rawMaterialCost: p.rawMaterialCost,
                    labourEntries: (p.labourEntries ?? []).map(le => ({
                        labourProcessType: le.labourProcessType as any,
                        party: le.party as any,
                        rate: le.rate,
                        rateType: le.rateType as "PER_PIECE" | "PER_KG",
                        cost: le.cost,
                    })),
                    totalLabourCost: p.totalLabourCost,
                    completeSupplyRate: p.completeSupplyRate,
                    completeSupplyParty: p.completeSupplyParty as any,
                    completeSupplyDate: p.completeSupplyDate
                        ? new Date(p.completeSupplyDate).toISOString()
                        : undefined,
                    costPrice: p.costPrice,
                    profitMargin: p.profitMargin,
                    profitAmount: p.profitAmount,
                    partTotal: p.partTotal,
                })),
                totalPartsCost: c.totalPartsCost,
                packingCost: c.packingCost,
                shippingCost: c.shippingCost,
                otherCosts: c.otherCosts,
                sellingPrice: c.sellingPrice,
                totalCost: c.totalCost,
            };
        });

    const grandTotal = items.reduce((sum, i) => sum + i.totalCost, 0);

    // Fetch regretted items for this RFQ
    const rfqItemIds = (rfq.items as unknown as string[]) ?? [];
    const regrettedRfqItems = await RFQItems.find({
        _id: { $in: rfqItemIds },
        isDeleted: false,
        isRegret: true,
    })
        .populate("item")
        .lean();

    const REGRET_REASON_LABELS: Record<string, string> = {
        NOT_IN_SCOPE: "Not in our scope",
        DRAWING_NOT_RECEIVED: "Drawing not received",
        ITEM_NOT_AVAILABLE: "Item not available",
    };

    const regrettedItems = regrettedRfqItems.map(ri => {
        const item = ri.item as any;
        let reasonText = "";
        if (ri.regretReason === "CUSTOM") {
            reasonText = ri.regretReasonCustom || "Custom reason";
        } else {
            reasonText = REGRET_REASON_LABELS[ri.regretReason ?? ""] ?? ri.regretReason ?? "";
        }
        return {
            serialNumber: ri.serialNumber ?? "",
            itemCode: item?.itemCode ?? "",
            itemName: item?.itemName ?? "",
            quantity: ri.quantity ?? 1,
            regretReason: reasonText,
        };
    });

    return {
        prNumber: rfq.prNumber,
        companyName: rfq.companyName,
        location: rfq.location,
        generatedDate: new Date().toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }),
        items,
        grandTotal,
        regrettedItems,
    };
}

export const downloadCostingSheetPdf = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;

        if (!rfqId || !mongoose.Types.ObjectId.isValid(rfqId)) {
            throw new ApiError(400, "Invalid RFQ ID");
        }

        const [data, company] = await Promise.all([
            buildCostingSheetData(rfqId),
            getCompanyProfileForGenerators(),
        ]);
        const logoBuffer = await fetchLogoBuffer(company);
        const pdfStream = generateCostingSheetPdf(data, company, logoBuffer);

        const safePr = data.prNumber.replace(/[^a-zA-Z0-9-_]/g, "_");
        const filename = `Costing Sheet - ${data.prNumber}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safePr}.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );

        pdfStream.pipe(res);
    }
);

export const uploadProofDocument = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const file = req.file;
        if (!file) {
            throw new ApiError(400, "Proof document file is required");
        }

        const result = await uploadFileToCloudinary(file.path);

        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }

        if (!result) {
            throw new ApiError(500, "Failed to upload proof document");
        }

        res.status(200).json(
            new ApiResponse(200, { url: result.secure_url }, "Proof document uploaded successfully")
        );
    }
);

export const downloadCostingSheetExcel = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const rfqId = req.params.rfqId!;

        if (!rfqId || !mongoose.Types.ObjectId.isValid(rfqId)) {
            throw new ApiError(400, "Invalid RFQ ID");
        }

        const [data, company] = await Promise.all([
            buildCostingSheetData(rfqId),
            getCompanyProfileForGenerators(),
        ]);
        const logoBuffer = await fetchLogoBuffer(company);
        const buffer = await generateCostingSheetExcel(data, company, logoBuffer);

        const safePr = data.prNumber.replace(/[^a-zA-Z0-9-_]/g, "_");
        const filename = `Costing Sheet - ${data.prNumber}.xlsx`;
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safePr}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );

        res.send(buffer);
    }
);
