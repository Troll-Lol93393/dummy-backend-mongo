import { Router } from "express";
import {
    createItem,
    getItem,
    updateItem,
    deleteItem,
    restoreItem,
    hardDeleteItem,
    getAllItems,
} from "../controller/item.controller";
import { verifyJWT } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyJWT);

// Item CRUD routes
router.post("/", verifyJWT, createItem);
router.get("/", verifyJWT, getItem);
router.put("/", verifyJWT, updateItem);
router.delete("/", verifyJWT, deleteItem); 
router.patch("/restore", verifyJWT, restoreItem);
router.delete("/permanent", verifyJWT, hardDeleteItem); 
router.get("/all", verifyJWT, getAllItems);

export { router as itemRoutes };
