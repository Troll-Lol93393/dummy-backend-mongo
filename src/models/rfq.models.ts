import mongoose from "mongoose";

export interface IRfq {
    number: string;
    date: Date;
    dueDate: Date;
    status: "OPEN" | "PENDING_SELECTION" | "COMPLETED" | "AWARDED" | "CANCELLED";
}