import { Router } from "express";
import {
    createItem,
    getItem,
    updateItem,
    deleteItem,
    restoreItem,
    hardDeleteItem,
    getAllItems,
} from "../controller/item-controller/item.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

// router.use(verifyJWT);

// Item CRUD routes
router.post("/", createItem);
router.get("/", getItem);
router.put("/", updateItem);
router.delete("/", deleteItem); 
router.patch("/restore", restoreItem);
router.delete("/permanent", hardDeleteItem); 
router.get("/all", getAllItems);

export { router as itemRoutes };
