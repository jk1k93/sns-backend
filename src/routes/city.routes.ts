import { Router } from "express";
import { createCity } from "../controllers/city.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const cityRouter = Router();

cityRouter.post("/", requireAuth, createCity);
