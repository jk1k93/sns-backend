import { Router } from "express";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "../controllers/team.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const teamRouter = Router({ mergeParams: true });

teamRouter.get("/", listTeams);
teamRouter.get("/:id", getTeam);
teamRouter.post("/", requireAuth, createTeam);
teamRouter.patch("/:id", requireAuth, updateTeam);
teamRouter.delete("/:id", requireAuth, deleteTeam);
