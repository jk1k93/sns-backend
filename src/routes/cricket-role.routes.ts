import { Router } from "express";
import { listCricketRoles } from "../controllers/cricket-role.controller.js";

export const cricketRoleRouter = Router();

cricketRoleRouter.get("/", listCricketRoles);
