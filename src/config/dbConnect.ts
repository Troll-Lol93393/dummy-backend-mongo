import mongoose from "mongoose";
import { DB_NAME } from "../constants";

const dbConnect = async () => {
    try {
        const connectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
        console.log(
            `MongoDB connected successfully to host: ${connectionInstance.connection.host}`
        );

        // Drop stale indexes that no longer match the schema
        try {
            const rfqCollection = connectionInstance.connection.collection("rfqs");
            const indexes = await rfqCollection.indexes();
            if (indexes.some(idx => idx.name === "number_1")) {
                await rfqCollection.dropIndex("number_1");
                console.log("Dropped stale index 'number_1' from rfqs collection");
            }
        } catch {
            // Index may not exist — safe to ignore
        }
    } catch (error) {
        console.log("MongoDB connection error", error);
    }
};

export default dbConnect;
