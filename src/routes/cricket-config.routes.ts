import { Router } from "express";
import {
  createCricketConfig,
  deleteCricketConfig,
  getCricketConfig,
  updateCricketConfig,
} from "../controllers/cricket-config.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const cricketConfigRouter = Router({ mergeParams: true });

cricketConfigRouter.get("/", getCricketConfig);
cricketConfigRouter.post("/", requireAuth, createCricketConfig);
cricketConfigRouter.patch("/", requireAuth, updateCricketConfig);
cricketConfigRouter.delete("/", requireAuth, deleteCricketConfig);
