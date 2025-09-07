import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { Request, Response, NextFunction } from "express";
import { Item } from "../models/item.model";

export const createRfqItems = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { itemCode, drawingNumber, drawingUrl, quantity } = req.body;

    if ([itemCode, quantity]?.some((item) => item.trim() === "" || !item)) {
        throw new ApiError(400, "Item Code or quantity is missng !");
    }

    const item = Item.findOne({ itemCode, isDeleted: false });

    if (!item) {

    }

});