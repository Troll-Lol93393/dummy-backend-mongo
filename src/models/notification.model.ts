import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
    message: string;
    type: "DUE_DATE_REMINDER" | "STATUS_CHANGE" | "ORDER_AWARDED";
    rfq: mongoose.Types.ObjectId;
    prNumber: string;
    isRead: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
    {
        message: {
            type: String,
            required: [true, "Message is required"],
            trim: true,
        },
        type: {
            type: String,
            enum: ["DUE_DATE_REMINDER", "STATUS_CHANGE", "ORDER_AWARDED"],
            required: [true, "Notification type is required"],
        },
        rfq: {
            type: Schema.Types.ObjectId,
            ref: "RFQ",
            required: true,
            index: true,
        },
        prNumber: {
            type: String,
            trim: true,
            required: true,
        },
        isRead: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Index to prevent duplicate daily reminders for the same RFQ
notificationSchema.index({ rfq: 1, type: 1, createdAt: 1 });

export const Notification = mongoose.model<INotification>("Notification", notificationSchema);
