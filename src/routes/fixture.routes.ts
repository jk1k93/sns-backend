import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createStages, listStages } from "../controllers/stage.controller.js";
import { generateFixtures, listStageFixtures, updateFixture, clearStageFixtures, resetTournamentStages, groupDraw, listGroups, getBracket, createKnockoutFixture, deleteKnockoutFixture, getEligibleTeams, submitCricketResult, getStandings } from "../controllers/fixture.controller.js";

export const fixtureRouter = Router();

fixtureRouter.get("/:id/stages", requireAuth, listStages);
fixtureRouter.post("/:id/stages", requireAuth, createStages);

fixtureRouter.post("/:id/stages/:stageId/generate-fixtures", requireAuth, generateFixtures);
fixtureRouter.post("/:id/stages/:stageId/group-draw", requireAuth, groupDraw);
fixtureRouter.get("/:id/stages/:stageId/groups", requireAuth, listGroups);
fixtureRouter.post("/:id/stages/:stageId/fixtures", requireAuth, createKnockoutFixture);
fixtureRouter.get("/:id/stages/:stageId/eligible-teams", requireAuth, getEligibleTeams);
fixtureRouter.get("/:id/stages/:stageId/standings", requireAuth, getStandings);
fixtureRouter.get("/:id/stages/:stageId/bracket", getBracket);
fixtureRouter.get("/:id/stages/:stageId/fixtures", requireAuth, listStageFixtures);
fixtureRouter.delete("/:id/stages/:stageId/fixtures", requireAuth, clearStageFixtures);
fixtureRouter.patch("/:id/fixtures/:fixtureId", requireAuth, updateFixture);
fixtureRouter.post("/:id/fixtures/:fixtureId/result", requireAuth, submitCricketResult);
fixtureRouter.delete("/:id/fixtures/:fixtureId", requireAuth, deleteKnockoutFixture);
fixtureRouter.delete("/:id/stages", requireAuth, resetTournamentStages);
