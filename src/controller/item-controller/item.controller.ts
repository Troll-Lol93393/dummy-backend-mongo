import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/apiResponse";
import { Item } from "../../models/item.model";
import mongoose from "mongoose";

export const createItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode, itemName, itemDesc, itemType, size } = req.body;

    if ([itemCode, itemName, itemDesc, itemType].some(value => !value || value?.trim() === "")) {
        throw new ApiError(400, "Item code, item name, item description and item type are required");
    }

    const item = await Item.findOne({ itemCode });

    if (item) {
        throw new ApiError(400, "Item already exists");
    }

    const newItem = await Item.create({
        itemCode,
        itemName,
        itemDesc,
        itemType,
        size: size ?? "",
    });

    res.status(201).json(new ApiResponse(201, newItem, "Item created succesfully !"))

});

export const getItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode } = req.query;
    const item = await Item.findOne({ itemCode });

    if (!item) {
        throw new ApiError(404, "Item not found");
    }
    res.status(200).json(new ApiResponse(200, item, "Item fetched successfully !"));
});

export const updateItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode } = req.query;
    const { itemName, itemDesc, itemType, size } = req.body;
    const item = await Item.findOne({ itemCode });
    if (!item) {
        throw new ApiError(404, "Item not found");
    }
    item.itemName = itemName;
    item.itemDesc = itemDesc;
    item.itemType = itemType;
    item.size = size;
    await item.save();
    if (!item) {
        throw new ApiError(400, "Issue occured while updating the item details");
    }
    res.status(200).json(new ApiResponse(200, item, "Item updated successfully !"));
});

export const deleteItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode } = req.query;
    const item = await Item.findOne({ itemCode });
    if (!item) {
        throw new ApiError(404, "Item not found");
    }

    // Soft delete - mark as deleted instead of removing from database
    item.isDeleted = true;
    item.deletedAt = new Date();
    await item.save();

    res.status(200).json(new ApiResponse(200, item, "Item soft deleted successfully !"));
});

export const restoreItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode } = req.query;
    const item = await Item.findOne({ itemCode, isDeleted: true });

    if (!item) {
        throw new ApiError(404, "Item not found");
    }

    if (!item.isDeleted) {
        throw new ApiError(400, "Item is not deleted");
    }

    // Restore the item
    item.isDeleted = false;
    item.deletedAt = undefined;
    await item.save();

    res.status(200).json(new ApiResponse(200, item, "Item restored successfully !"));
});

export const hardDeleteItem = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode } = req.query;
    const item = await Item.findOne({ itemCode, isDeleted: true });

    if (!item) {
        throw new ApiError(404, "Item not found");
    }

    // Check if item is referenced in any RFQ
    const RFQItems = mongoose.model("RFQItems");
    const referencedInRFQ = await RFQItems.findOne({ item: item._id });

    if (referencedInRFQ) {
        throw new ApiError(400, "Cannot hard delete item as it is referenced in RFQ items. Use soft delete instead.");
    }

    // Hard delete - permanently remove from database
    await item.deleteOne();

    res.status(200).json(new ApiResponse(200, null, "Item permanently deleted successfully !"));
});