import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { queryFlag } from "../helpers/query.helper.js";

export async function listCricketRoles(req: Request, res: Response): Promise<void> {
  const activeOnly = queryFlag(typeof req.query.activeOnly === "string" ? req.query.activeOnly : undefined);

  try {
    const roles = await prisma.cricketRole.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: "asc" },
    });
    res.status(200).json({ message: "Cricket roles fetched successfully", data: roles });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch cricket roles" });
  }
}
