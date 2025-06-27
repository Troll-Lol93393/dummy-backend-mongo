import multer from "multer";
import { Request, Response, NextFunction } from "express";

const storage = multer.diskStorage({
    destination: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
        cb(null, '/public/temp/');
    },
    filename: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
        cb(null, file.fieldname);
    }
})

const upload = multer({ storage: storage })
