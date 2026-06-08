import { Router } from "express";
import { login, verifyOtp } from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/verify-otp", verifyOtp);
