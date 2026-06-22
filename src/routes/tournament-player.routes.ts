import { Router } from "express";
import {
  addTournamentPlayer,
  getTournamentPlayer,
  listTournamentPlayers,
  removeTournamentPlayer,
  updateTournamentPlayer,
} from "../controllers/tournament-player.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const tournamentPlayerRouter = Router({ mergeParams: true });

tournamentPlayerRouter.get("/", listTournamentPlayers);
tournamentPlayerRouter.get("/:id", getTournamentPlayer);
tournamentPlayerRouter.post("/", requireAuth, addTournamentPlayer);
tournamentPlayerRouter.patch("/:id", requireAuth, updateTournamentPlayer);
tournamentPlayerRouter.delete("/:id", requireAuth, removeTournamentPlayer);
