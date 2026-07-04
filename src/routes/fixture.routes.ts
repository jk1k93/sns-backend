import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createStages, listStages } from "../controllers/stage.controller.js";
import { generateFixtures, listStageFixtures, updateFixture, clearStageFixtures, resetTournamentStages } from "../controllers/fixture.controller.js";

export const fixtureRouter = Router();

fixtureRouter.get("/:id/stages", requireAuth, listStages);
fixtureRouter.post("/:id/stages", requireAuth, createStages);

fixtureRouter.post("/:id/stages/:stageId/generate-fixtures", requireAuth, generateFixtures);
fixtureRouter.get("/:id/stages/:stageId/fixtures", requireAuth, listStageFixtures);
fixtureRouter.delete("/:id/stages/:stageId/fixtures", requireAuth, clearStageFixtures);
fixtureRouter.patch("/:id/fixtures/:fixtureId", requireAuth, updateFixture);
fixtureRouter.delete("/:id/stages", requireAuth, resetTournamentStages);
