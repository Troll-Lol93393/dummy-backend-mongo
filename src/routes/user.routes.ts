import { Router } from "express";
import { register } from "../controller/user.controller";

export const userRoutes = Router();

userRoutes.post("/register", register);

