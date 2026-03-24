import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadFileToCloudinary = async (localFilePath: string) => {
    try {
        if (!localFilePath) return null;
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
            timeout: 60000,
        });
        return response;
    } catch (error: unknown) {
        console.error("Cloudinary upload error:", error);
        // Retry once on timeout/5xx
        try {
            const response = await cloudinary.uploader.upload(localFilePath, {
                resource_type: "auto",
                timeout: 60000,
            });
            return response;
        } catch (retryError: unknown) {
            if (fs.existsSync(localFilePath)) {
                fs.unlinkSync(localFilePath);
            }
            console.error("Cloudinary retry also failed:", retryError);
            return null;
        }
    }
};
