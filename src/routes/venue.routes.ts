import { Router } from "express";
import { createVenue, searchVenues } from "../controllers/venue.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const venueRouter = Router();

venueRouter.get("/search", requireAuth, searchVenues);
venueRouter.post("/", requireAuth, createVenue);
