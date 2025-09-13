import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
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

export const getAllRfqItems = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const rfqItems = await RFQItems.find({ isDeleted: false }).populate(["item", "itemTechSpecs", "commercialSpecs"]);

    res.status(200).json({
        success: true,
        message: "RFQ Items fetched successfully",
        data: rfqItems,
    });
});
