import type { Request, Response } from "express";
import { FixtureStatus, LineupParticipationType } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";
import { assertTournamentAccess } from "./fixture.controller.js";

const STARTING_XI_SIZE = 11;

const lineupSelect = {
  tournamentPlayerId: true,
  teamId: true,
  isCaptain: true,
  participationType: true,
} as const;

// GET /tournaments/:id/fixtures/:fixtureId/lineup
export async function getFixtureLineup(req: Request, res: Response): Promise<void> {
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

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { id: true, tournamentId: true, isDeleted: true },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }

    const entries = await prisma.cricketFixtureLineUp.findMany({
      where: { fixtureId, isDeleted: false },
      select: lineupSelect,
    });

    res.status(200).json({ message: "Lineup fetched successfully", data: entries });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch lineup" });
  }
}

type IncomingEntry = {
  tournamentPlayerId: string;
  teamId: string;
  isCaptain: boolean;
  participationType: LineupParticipationType;
};

function parseEntries(raw: unknown): { entries: IncomingEntry[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "entries must be a non-empty array" };
  }

  const entries: IncomingEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { error: "each entry must be an object" };
    }
    const { tournamentPlayerId, teamId, isCaptain, participationType } = item as Record<string, unknown>;

    if (typeof tournamentPlayerId !== "string" || !isUuid(tournamentPlayerId)) {
      return { error: "entries[].tournamentPlayerId must be a valid UUID" };
    }
    if (seen.has(tournamentPlayerId)) {
      return { error: `tournamentPlayerId ${tournamentPlayerId} is duplicated` };
    }
    seen.add(tournamentPlayerId);

    if (typeof teamId !== "string" || !isUuid(teamId)) {
      return { error: "entries[].teamId must be a valid UUID" };
    }
    if (isCaptain !== undefined && typeof isCaptain !== "boolean") {
      return { error: "entries[].isCaptain must be a boolean" };
    }
    if (participationType !== LineupParticipationType.STARTING && participationType !== LineupParticipationType.SUBSTITUTE) {
      return { error: "entries[].participationType must be STARTING or SUBSTITUTE" };
    }

    entries.push({
      tournamentPlayerId,
      teamId,
      isCaptain: isCaptain ?? false,
      participationType,
    });
  }

  return { entries };
}

// PUT /tournaments/:id/fixtures/:fixtureId/lineup
export async function setFixtureLineup(req: Request, res: Response): Promise<void> {
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

  const parsed = parseEntries(req.body?.entries);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { entries } = parsed;

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: {
        id: true,
        tournamentId: true,
        isDeleted: true,
        isBye: true,
        homeTeamId: true,
        awayTeamId: true,
        status: true,
      },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }
    if (fixture.isBye) {
      res.status(400).json({ error: "Cannot set a lineup for a bye fixture" });
      return;
    }
    if (!fixture.homeTeamId || !fixture.awayTeamId) {
      res.status(400).json({ error: "Both teams must be assigned before setting a lineup" });
      return;
    }
    if (fixture.status === FixtureStatus.COMPLETED || fixture.status === FixtureStatus.CANCELLED) {
      res.status(400).json({ error: "Cannot change the lineup for a completed or cancelled fixture" });
      return;
    }

    const validTeamIds = new Set([fixture.homeTeamId, fixture.awayTeamId]);
    for (const entry of entries) {
      if (!validTeamIds.has(entry.teamId)) {
        res.status(400).json({ error: "entries[].teamId must be one of the fixture's two teams" });
        return;
      }
    }

    const byTeam = new Map<string, IncomingEntry[]>();
    for (const entry of entries) {
      const list = byTeam.get(entry.teamId) ?? [];
      list.push(entry);
      byTeam.set(entry.teamId, list);
    }
    for (const teamId of validTeamIds) {
      const teamEntries = byTeam.get(teamId) ?? [];
      const startingCount = teamEntries.filter((e) => e.participationType === LineupParticipationType.STARTING).length;
      if (startingCount !== STARTING_XI_SIZE) {
        res.status(400).json({
          error: `Team ${teamId} must have exactly ${STARTING_XI_SIZE} starting players (got ${startingCount})`,
        });
        return;
      }
      const captains = teamEntries.filter((e) => e.isCaptain);
      if (captains.length > 1) {
        res.status(400).json({ error: `Team ${teamId} cannot have more than one captain` });
        return;
      }
      if (captains.length === 1 && captains[0].participationType !== LineupParticipationType.STARTING) {
        res.status(400).json({ error: `Team ${teamId}'s captain must be in the starting XI` });
        return;
      }
    }

    const tournamentPlayerIds = entries.map((e) => e.tournamentPlayerId);
    const players = await prisma.tournamentPlayer.findMany({
      where: { id: { in: tournamentPlayerIds }, tournamentId, isDeleted: false },
      select: { id: true, teamId: true },
    });
    const playerById = new Map(players.map((p) => [p.id, p]));
    for (const entry of entries) {
      const player = playerById.get(entry.tournamentPlayerId);
      if (!player) {
        res.status(400).json({ error: `tournamentPlayerId ${entry.tournamentPlayerId} not found in this tournament` });
        return;
      }
      if (player.teamId !== entry.teamId) {
        res.status(400).json({ error: `Player ${entry.tournamentPlayerId} does not belong to team ${entry.teamId}` });
        return;
      }
    }

    const saved = await prisma.$transaction(async (tx) => {
      await tx.cricketFixtureLineUp.updateMany({
        where: { fixtureId, isDeleted: false, tournamentPlayerId: { notIn: tournamentPlayerIds } },
        data: { isDeleted: true },
      });

      for (const entry of entries) {
        await tx.cricketFixtureLineUp.upsert({
          where: { fixtureId_tournamentPlayerId: { fixtureId, tournamentPlayerId: entry.tournamentPlayerId } },
          create: {
            fixtureId,
            teamId: entry.teamId,
            tournamentPlayerId: entry.tournamentPlayerId,
            isCaptain: entry.isCaptain,
            participationType: entry.participationType,
          },
          update: {
            teamId: entry.teamId,
            isCaptain: entry.isCaptain,
            participationType: entry.participationType,
            isDeleted: false,
          },
        });
      }

      return tx.cricketFixtureLineUp.findMany({
        where: { fixtureId, isDeleted: false },
        select: lineupSelect,
      });
    });

    res.status(200).json({ message: "Lineup saved successfully", data: saved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save lineup" });
  }
}
