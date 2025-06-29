import { Router } from "express";
import { login, register } from "../controller/user.controller";

export const userRoutes = Router();

userRoutes.post("/register", register);
userRoutes.post("/login", login);

