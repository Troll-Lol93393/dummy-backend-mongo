import { Router } from "express";
import {
    login,
    register,
    logout,
    refreshAccessToken,
    getCurrentUser,
    updateUserProfile,
    changePassword,
} from "../controller/user.controller";
import { verifyJWT, verifyRoles } from "../middlewares/auth.middleware";
import { ApiResponse } from "../utils/apiResponse";

export const userRoutes = Router();

// Public routes
userRoutes.post("/register", register);
userRoutes.post("/login", login);
userRoutes.post("/refresh-token", refreshAccessToken);

// Protected routes
userRoutes.post("/logout", verifyJWT, logout);
userRoutes.get("/profile", verifyJWT, getCurrentUser);
userRoutes.patch("/profile", verifyJWT, updateUserProfile);
userRoutes.patch("/change-password", verifyJWT, changePassword);

// Admin only routes
userRoutes.get(
    "/admin/users",
    verifyJWT,
    verifyRoles("ROLE_ADMIN", "ROLE_TECH_ADMIN"),
    (req, res) => {
        // TODO: Implement get all users functionality
        res.json(new ApiResponse(200, [], "Get all users endpoint - TODO"));
    }
);
