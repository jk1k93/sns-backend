import { Router } from "express";
import {
  createSport,
  deleteSport,
  getSport,
  listSports,
  updateSport,
} from "../controllers/sports.controller.js";
export const sportsRouter = Router();

sportsRouter.get("/", listSports);
sportsRouter.get("/:id", getSport);
sportsRouter.post("/", createSport);
sportsRouter.patch("/:id", updateSport);
sportsRouter.delete("/:id", deleteSport);
