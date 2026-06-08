import { Router } from "express";
import { getProfile, updateProfile } from "../controllers/profile.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const profileRouter = Router();

profileRouter.get("/profile", requireAuth, getProfile);
profileRouter.patch("/profile", requireAuth, updateProfile);
