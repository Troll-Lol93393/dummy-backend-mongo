import multer from "multer";
import { Request, Response, NextFunction } from "express";

const storage = multer.diskStorage({
    destination: function (
        req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, destination: string) => void
    ) {
        cb(null, "public/temp/");
    },
    filename: function (
        req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, filename: string) => void
    ) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = file.originalname.substring(file.originalname.lastIndexOf("."));
        cb(null, uniqueSuffix + ext);
    },
});

const upload = multer({ storage: storage });

export { upload };
