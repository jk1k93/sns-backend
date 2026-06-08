import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { profileRouter } from "./profile.routes.js";
import { sportsRouter } from "./sports.routes.js";
import { venueRouter } from "./venue.routes.js";
import { cityRouter } from "./city.routes.js";

const router = Router();

router.use(authRouter);
router.use(profileRouter);
router.use("/sports", sportsRouter);
router.use("/venues", venueRouter);
router.use("/cities", cityRouter);

export default router;
