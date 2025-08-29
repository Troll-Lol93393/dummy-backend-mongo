import mongoose, { Schema } from "mongoose";

export interface Items {
    itemCode: string,
    itemName: string,
    itemDesc: string,
    drawingNumber: string,
    itemType: "SET"|"ASSEMBLY"|"UNIT",
    size: string;
    
}

export const itemSchema: Schema<Items> = new Schema(
    {

    },
    {
        timestamps: true,
    }
)