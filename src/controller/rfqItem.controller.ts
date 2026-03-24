import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { Request, Response, NextFunction } from "express";
import { Item } from "../models/item.model";
import { RFQItems } from "../models/rfqItems.model";
import { ItemTechSpecs } from "../models/item.techSpecs.model";
import { CommercialSpecs } from "../models/item.commercial.model";

export const createRfqItems = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode, itemName, itemDesc, itemType, drawingNumber, drawingUrl, quantity } = req.body;

    if (!itemCode || !quantity) {
        throw new ApiError(400, "Item code / Item quantity is required !");
    }
    // if item is found fetch it
    const item = await Item.findOne({ itemCode, isDeleted: false });
    let rfqItem = {};

    // if item is not found create it
    if (!item) {
        if ([itemCode, itemName, itemDesc, itemType, quantity]?.some((item) => item?.trim() === "")) {
            throw new ApiError(400, "Item Code/ Item Name/ Item quantity / Item description / Item type is required !");
        }

        if (!["SET", "ASSEMBLY", "UNIT"].includes(itemType)) {
            throw new ApiError(400, "Item type should be SET / ASSEMBLY / UNIT");
        }

        if (!quantity || parseInt(quantity) <= 0) {
            throw new ApiError(400, "Item quantity should be greater than 0");
        }

        const newItem = await Item.create({
            itemCode: itemCode,
            itemName: itemName,
            itemDesc: itemDesc,
            itemType: itemType,
            isDeleted: false,
        });

        const itemTechSpecs = await ItemTechSpecs.create({
            material: "",
        })

        const commercialSpecs = await CommercialSpecs.create({
            currency: "INR",
            rawMaterialCost: 0,
            laborCost: 0,
            profitMargin: 0,
            totalCost: 0,
            packingCost: 0,
            shippingCost: 0,
            sellingPrice: 0,
            otherCosts: 0
        })

        rfqItem = await RFQItems.create({
            item: newItem._id,
            quantity: quantity,
            drawingNumber: drawingNumber ?? "",
            drawingUrl: drawingUrl ?? "",
            itemTechSpecs: itemTechSpecs._id,
            commercialSpecs: commercialSpecs._id,
            isDeleted: false,
        });
    } else {
        const itemTechSpecs = await ItemTechSpecs.create({
            material: "",
        })

        const commercialSpecs = await CommercialSpecs.create({
            currency: "INR",
            rawMaterialCost: 0,
            laborCost: 0,
            profitMargin: 0,
            totalCost: 0,
            packingCost: 0,
            shippingCost: 0,
            sellingPrice: 0,
            otherCosts: 0
        })

        rfqItem = await RFQItems.create({
            item: item?._id,
            quantity: parseInt(quantity),
            drawingNumber: drawingNumber ?? "",
            drawingUrl: drawingUrl ?? "",
            itemTechSpecs: itemTechSpecs._id,
            commercialSpecs: commercialSpecs._id,
            isDeleted: false,
        });
    }

    res.status(200).json({
        success: true,
        message: "RFQ Item added successfully",
        data: rfqItem,
    });
});

export const updateRfqItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { rfqItemId } = req.params;
    const { quantity, drawingNumber, drawingUrl, itemTechSpecs, commercialSpecs } = req.body;

    const rfqItem = await RFQItems.findOne({ _id: rfqItemId, isDeleted: false }).populate([
        "itemTechSpecs",
        "commercialSpecs",
    ]);
    if (!rfqItem) {
        throw new ApiError(404, "RFQ Item not found");
    }

    if (quantity !== undefined) rfqItem.quantity = quantity;
    if (drawingNumber !== undefined) rfqItem.drawingNumber = drawingNumber;
    if (drawingUrl !== undefined) rfqItem.drawingUrl = drawingUrl;

    if (itemTechSpecs) {
        const existingTech = rfqItem.itemTechSpecs as ItemTechSpecs | null;

        // Sanitize hardness entries — strip _id so Mongoose generates fresh ones
        const sanitizedHardness = Array.isArray(itemTechSpecs.hardness)
            ? itemTechSpecs.hardness.map((h: any) => ({
                  hardnessType: h.hardnessType,
                  value: h.value,
                  measurement: h.measurement,
              }))
            : undefined;

        if (existingTech && existingTech.material !== undefined) {
            // Existing doc found via populate — update it
            const updateFields: Record<string, unknown> = {
                material: itemTechSpecs.material,
                diameter: itemTechSpecs.diameter,
                length: itemTechSpecs.length,
                weight: itemTechSpecs.weight,
                grade: itemTechSpecs.grade,
                remarks: itemTechSpecs.remarks,
            };
            if (sanitizedHardness !== undefined) {
                updateFields.hardness = sanitizedHardness;
            }
            await ItemTechSpecs.findByIdAndUpdate((existingTech as any)._id, {
                $set: updateFields,
            });
        } else {
            const newTechSpecs = await ItemTechSpecs.create({
                material: itemTechSpecs.material ?? "",
                diameter: itemTechSpecs.diameter ?? "",
                length: itemTechSpecs.length ?? "",
                weight: itemTechSpecs.weight ?? "",
                grade: itemTechSpecs.grade ?? "",
                remarks: itemTechSpecs.remarks ?? "",
                hardness: sanitizedHardness ?? [],
            });
            rfqItem.itemTechSpecs = newTechSpecs._id as unknown as ItemTechSpecs;
        }
    }

    if (commercialSpecs) {
        const existingCommercial = rfqItem.commercialSpecs as CommercialSpecs | null;
        if (existingCommercial && existingCommercial.currency !== undefined) {
            await CommercialSpecs.findByIdAndUpdate((existingCommercial as any)._id, {
                $set: {
                    currency: commercialSpecs.currency,
                    rawMaterialCost: commercialSpecs.rawMaterialCost,
                    laborCost: commercialSpecs.laborCost,
                    profitMargin: commercialSpecs.profitMargin,
                    totalCost: commercialSpecs.totalCost,
                    packingCost: commercialSpecs.packingCost,
                    shippingCost: commercialSpecs.shippingCost,
                    sellingPrice: commercialSpecs.sellingPrice,
                    otherCosts: commercialSpecs.otherCosts,
                },
            });
        } else {
            const newCommercialSpecs = await CommercialSpecs.create({
                currency: commercialSpecs.currency ?? "INR",
                rawMaterialCost: commercialSpecs.rawMaterialCost ?? 0,
                laborCost: commercialSpecs.laborCost ?? 0,
                profitMargin: commercialSpecs.profitMargin ?? 0,
                totalCost: commercialSpecs.totalCost ?? 0,
                packingCost: commercialSpecs.packingCost ?? 0,
                shippingCost: commercialSpecs.shippingCost ?? 0,
                sellingPrice: commercialSpecs.sellingPrice ?? 0,
                otherCosts: commercialSpecs.otherCosts ?? 0,
            });
            rfqItem.commercialSpecs = newCommercialSpecs._id as unknown as CommercialSpecs;
        }
    }

    await rfqItem.save();

    const updatedItem = await RFQItems.findById(rfqItemId).populate([
        "item",
        "itemTechSpecs",
        "commercialSpecs",
    ]);

    res.status(200).json(new ApiResponse(200, updatedItem, "RFQ Item updated successfully"));
});

export const getAllRfqItems = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const rfqItems = await RFQItems.find({ isDeleted: false }).populate(["item", "itemTechSpecs", "commercialSpecs"]);

    res.status(200).json({
        success: true,
        message: "RFQ Items fetched successfully",
        data: rfqItems,
    });
});
