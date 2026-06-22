import { Router } from "express";
import {
  createCricketPlayerProfile,
  deleteCricketPlayerProfile,
  getCricketPlayerProfile,
  updateCricketPlayerProfile,
} from "../controllers/cricket-player-profile.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const cricketPlayerProfileRouter = Router();

cricketPlayerProfileRouter.get("/:userId", getCricketPlayerProfile);
cricketPlayerProfileRouter.post("/", requireAuth, createCricketPlayerProfile);
cricketPlayerProfileRouter.patch("/:userId", requireAuth, updateCricketPlayerProfile);
cricketPlayerProfileRouter.delete("/:userId", requireAuth, deleteCricketPlayerProfile);
