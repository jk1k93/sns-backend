import type { Request, Response } from "express";
import { StageType } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";
import { parseDate } from "../helpers/date.helper.js";

const fixtureSelect = {
  id: true,
  tournamentId: true,
  stageId: true,
  homeTeamId: true,
  homeTeam: { select: { id: true, name: true, shortCode: true } },
  awayTeamId: true,
  awayTeam: { select: { id: true, name: true, shortCode: true } },
  scheduledAt: true,
  status: true,
} as const;

async function assertTournamentAccess(
  tournamentId: string,
  userId: string,
): Promise<{ error: string; status: number } | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId, isDeleted: false },
    select: {
      organiserId: true,
      contacts: { where: { isDeleted: false }, select: { userId: true } },
    },
  });
  if (!tournament) return { error: "Tournament not found", status: 404 };
  const isOrganiser = tournament.organiserId === userId;
  const isContact = tournament.contacts.some((c) => c.userId === userId);
  if (!isOrganiser && !isContact) return { error: "Forbidden", status: 403 };
  return null;
}

function roundRobinPairs(teamIds: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]]);
    }
  }
  return pairs;
}

export async function generateFixtures(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  const stageId = paramId(req.params.stageId);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }
  if (!stageId || !isUuid(stageId)) {
    res.status(400).json({ error: "Invalid stage id" });
    return;
  }

  const userId = req.auth!.userId;
  const accessError = await assertTournamentAccess(tournamentId, userId);
  if (accessError) {
    res.status(accessError.status).json({ error: accessError.error });
    return;
  }

  try {
    const stage = await prisma.tournamentStage.findUnique({
      where: { id: stageId },
      select: { id: true, tournamentId: true, isDeleted: true, type: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    if (stage.type !== StageType.ROUND_ROBIN) {
      res.status(400).json({ error: "Only League (round-robin) stages can use auto-generate" });
      return;
    }

    const existing = await prisma.fixture.findFirst({
      where: { stageId, isDeleted: false },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ error: "Fixtures already generated for this stage" });
      return;
    }

    const teams = await prisma.team.findMany({
      where: { tournamentId, isDeleted: false },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (teams.length < 2) {
      res.status(400).json({ error: "At least 2 teams are required to generate fixtures" });
      return;
    }

    const pairs = roundRobinPairs(teams.map((t) => t.id));

    await prisma.fixture.createMany({
      data: pairs.map(([homeTeamId, awayTeamId]) => ({
        tournamentId,
        stageId,
        homeTeamId,
        awayTeamId,
      })),
    });

    const fixtures = await prisma.fixture.findMany({
      where: { stageId, isDeleted: false },
      select: fixtureSelect,
      orderBy: { createdAt: "asc" },
    });

    res.status(201).json({ message: "Fixtures generated successfully", data: fixtures });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to generate fixtures" });
  }
}

export async function listStageFixtures(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  const stageId = paramId(req.params.stageId);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }
  if (!stageId || !isUuid(stageId)) {
    res.status(400).json({ error: "Invalid stage id" });
    return;
  }

  try {
    const stage = await prisma.tournamentStage.findUnique({
      where: { id: stageId },
      select: { id: true, tournamentId: true, isDeleted: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }

    const fixtures = await prisma.fixture.findMany({
      where: { stageId, isDeleted: false },
      select: fixtureSelect,
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json({ message: "Fixtures fetched successfully", data: fixtures });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch fixtures" });
  }
}

export async function clearStageFixtures(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  const stageId = paramId(req.params.stageId);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }
  if (!stageId || !isUuid(stageId)) {
    res.status(400).json({ error: "Invalid stage id" });
    return;
  }

  const userId = req.auth!.userId;
  const accessError = await assertTournamentAccess(tournamentId, userId);
  if (accessError) {
    res.status(accessError.status).json({ error: accessError.error });
    return;
  }

  try {
    const stage = await prisma.tournamentStage.findUnique({
      where: { id: stageId },
      select: { id: true, tournamentId: true, isDeleted: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }

    await prisma.fixture.updateMany({
      where: { stageId, isDeleted: false },
      data: { isDeleted: true },
    });

    res.status(200).json({ message: "Fixtures cleared successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to clear fixtures" });
  }
}

export async function resetTournamentStages(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  const userId = req.auth!.userId;
  const accessError = await assertTournamentAccess(tournamentId, userId);
  if (accessError) {
    res.status(accessError.status).json({ error: accessError.error });
    return;
  }

  try {
    // Soft-delete all fixtures for this tournament first, then all stages
    await prisma.fixture.updateMany({
      where: { tournamentId, isDeleted: false },
      data: { isDeleted: true },
    });
    await prisma.tournamentStage.updateMany({
      where: { tournamentId, isDeleted: false },
      data: { isDeleted: true },
    });

    res.status(200).json({ message: "Tournament stages and fixtures reset successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to reset tournament" });
  }
}

export async function updateFixture(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  const fixtureId = paramId(req.params.fixtureId);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }
  if (!fixtureId || !isUuid(fixtureId)) {
    res.status(400).json({ error: "Invalid fixture id" });
    return;
  }

  const userId = req.auth!.userId;
  const accessError = await assertTournamentAccess(tournamentId, userId);
  if (accessError) {
    res.status(accessError.status).json({ error: accessError.error });
    return;
  }

  const { scheduledAt: scheduledAtRaw } = req.body ?? {};
  if (scheduledAtRaw === undefined) {
    res.status(400).json({ error: "scheduledAt is required" });
    return;
  }

  const parsed = scheduledAtRaw === null ? { value: null } : parseDate(scheduledAtRaw, "scheduledAt");
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { id: true, tournamentId: true, isDeleted: true },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }

    const updated = await prisma.fixture.update({
      where: { id: fixtureId },
      data: { scheduledAt: parsed.value },
      select: fixtureSelect,
    });

    res.status(200).json({ message: "Fixture updated successfully", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update fixture" });
  }
}
