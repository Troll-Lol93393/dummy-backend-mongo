import dbConnect from "./config/dbConnect";
import dotenv from "dotenv";
import { app } from "./app";

dotenv.config({ path: "./.env" });

dbConnect().then(() => {
    app.listen(process.env.PORT, () => {
        console.log(`Server is running on port ${process.env.PORT}`);
    });
}).catch((err) => {
    console.log("MongoDB connection error", err);
});
