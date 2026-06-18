import { Router } from "express";
import {
  createTournament,
  deleteTournament,
  getTournament,
  listTournaments,
  updateTournament,
} from "../controllers/tournament.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const tournamentRouter = Router();

tournamentRouter.get("/", listTournaments);
tournamentRouter.get("/:id", requireAuth, getTournament);
tournamentRouter.post("/", requireAuth, createTournament);
tournamentRouter.patch("/:id", requireAuth, updateTournament);
tournamentRouter.delete("/:id", requireAuth, deleteTournament);
