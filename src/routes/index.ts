import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { profileRouter } from "./profile.routes.js";
import { sportsRouter } from "./sports.routes.js";
import { venueRouter } from "./venue.routes.js";
import { cityRouter } from "./city.routes.js";
import { tournamentRouter } from "./tournament.routes.js";
import { cricketConfigRouter } from "./cricket-config.routes.js";
import { teamRouter } from "./team.routes.js";
import { tournamentPlayerRouter } from "./tournament-player.routes.js";
import { cricketRoleRouter } from "./cricket-role.routes.js";
import { cricketPlayerProfileRouter } from "./cricket-player-profile.routes.js";

const router = Router();

router.use(authRouter);
router.use(profileRouter);
router.use("/sports", sportsRouter);
router.use("/venues", venueRouter);
router.use("/cities", cityRouter);
router.use("/tournaments", tournamentRouter);
router.use("/tournaments/:id/cricket-config", cricketConfigRouter);
router.use("/tournaments/:tournamentId/teams", teamRouter);
router.use("/tournaments/:tournamentId/players", tournamentPlayerRouter);
router.use("/cricket-roles", cricketRoleRouter);
router.use("/cricket-player-profiles", cricketPlayerProfileRouter);

export default router;
