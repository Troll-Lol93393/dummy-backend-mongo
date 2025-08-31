import { Router } from "express";
import {
    createItem,
    getItem,
    updateItem,
    deleteItem,
    restoreItem,
    hardDeleteItem,
} from "../controller/item-controller/item.controller";

const router = Router();

// Item CRUD routes
router.post("/", createItem);
router.get("/", getItem);
router.put("/", updateItem);
router.delete("/", deleteItem); 
router.patch("/restore", restoreItem);
router.delete("/permanent", hardDeleteItem); 

export { router as itemRoutes };
