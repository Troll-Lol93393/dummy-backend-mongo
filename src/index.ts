import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import dbConnect from "./config/dbConnect";
import { app } from "./app";

dbConnect()
    .then(() => {
        app.listen(process.env.PORT || 8081, () => {
            console.log(`Server is running on port ${process.env.PORT}`);
        });
    })
    .catch(err => {
        console.log("MongoDB connection error", err);
    });
