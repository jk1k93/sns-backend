import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function paramId(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : value[0];
}

function queryFlag(value: unknown): boolean {
  const v =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : undefined;
  return v === "true" || v === "1";
}

export async function listSports(req: Request, res: Response): Promise<void> {
  const activeOnly = queryFlag(req.query.activeOnly);

  try {
    const sports = await prisma.sport.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: "asc" },
    });
    res.status(200).json({
      message: "Sports fetched successfully",
      data: sports,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch sports" });
  }
}

export async function getSport(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid sport id" });
    return;
  }

  try {
    const sport = await prisma.sport.findUnique({ where: { id } });
    if (!sport) {
      res.status(404).json({ error: "Sport not found" });
      return;
    }
    res.status(200).json({
      message: "Sport fetched successfully",
      data: sport,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch sport" });
  }
}

export async function createSport(req: Request, res: Response): Promise<void> {
  const nameRaw = req.body?.name;
  if (typeof nameRaw !== "string" || !nameRaw.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const name = nameRaw.trim();

  try {
    const sport = await prisma.sport.create({
      data: { name, isActive: true },
    });
    res.status(201).json({
      message: "Sport created successfully",
      data: sport,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(409).json({ error: "A sport with this name already exists" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to create sport" });
  }
}

export async function updateSport(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid sport id" });
    return;
  }

  const nameRaw = req.body?.name;
  if (typeof nameRaw !== "string" || !nameRaw.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const name = nameRaw.trim();

  try {
    const sport = await prisma.sport.update({
      where: { id },
      data: { name },
    });
    res.status(200).json({
      message: "Sport updated successfully",
      data: sport,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(409).json({ error: "A sport with this name already exists" });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "Sport not found" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update sport" });
  }
}

export async function deleteSport(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id);
  if (!id || !isUuid(id)) {
    res.status(400).json({ error: "Invalid sport id" });
    return;
  }

  try {
    const sport = await prisma.sport.update({
      where: { id },
      data: { isActive: false },
    });
    res.status(200).json({
      message: "Sport deactivated successfully",
      data: sport,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "Sport not found" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to deactivate sport" });
  }
}
