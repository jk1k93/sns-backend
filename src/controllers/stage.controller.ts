import type { Request, Response } from "express";
import { StageType } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";

const DEFAULT_NAMES: Record<StageType, string> = {
  GROUP: "Group Stage",
  ROUND_ROBIN: "League",
  KNOCKOUT: "Knockout",
};

const VALID_TYPES = new Set<string>(Object.values(StageType));

type StageInput = {
  type: StageType;
  teamsAdvancing: number | null;
  numberOfGroups: number | null;
  teamsAdvancingPerGroup: number | null;
};

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

export async function listStages(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }

  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId, isDeleted: false },
      select: { id: true },
    });
    if (!tournament) {
      res.status(404).json({ error: "Tournament not found" });
      return;
    }

    const stages = await prisma.tournamentStage.findMany({
      where: { tournamentId, isDeleted: false },
      select: { id: true, type: true, order: true, name: true, status: true, teamsAdvancing: true, numberOfGroups: true, teamsAdvancingPerGroup: true },
      orderBy: { order: "asc" },
    });

    res.status(200).json({ message: "Stages fetched successfully", data: stages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch stages" });
  }
}

export async function createStages(req: Request, res: Response): Promise<void> {
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

  const { stages: stagesRaw } = req.body ?? {};
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    res.status(400).json({ error: "stages must be a non-empty array" });
    return;
  }

  for (let i = 0; i < stagesRaw.length; i++) {
    const entry = stagesRaw[i];
    if (typeof entry !== "object" || entry === null) {
      res.status(400).json({ error: `stages[${i}] must be an object` });
      return;
    }
    if (!VALID_TYPES.has(entry.type)) {
      res.status(400).json({
        error: `stages[${i}].type must be one of: ${[...VALID_TYPES].join(", ")}`,
      });
      return;
    }
    const isLast = i === stagesRaw.length - 1;

    if (entry.type === StageType.ROUND_ROBIN && !isLast) {
      const ta = entry.teamsAdvancing;
      if (typeof ta !== "number" || !Number.isInteger(ta) || ta < 2) {
        res.status(400).json({
          error: `stages[${i}].teamsAdvancing must be greater than 1 for a League stage followed by another stage`,
        });
        return;
      }
    }

    if (entry.type === StageType.GROUP) {
      const ng = entry.numberOfGroups;
      if (typeof ng !== "number" || !Number.isInteger(ng) || ng < 2) {
        res.status(400).json({ error: `stages[${i}].numberOfGroups must be an integer ≥ 2` });
        return;
      }
      const tap = entry.teamsAdvancingPerGroup;
      if (typeof tap !== "number" || !Number.isInteger(tap) || tap < 1) {
        res.status(400).json({ error: `stages[${i}].teamsAdvancingPerGroup must be a positive integer` });
        return;
      }
    }
  }

  try {
    const existing = await prisma.tournamentStage.findFirst({
      where: { tournamentId, isDeleted: false },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ error: "Stages already exist for this tournament" });
      return;
    }

    const inputs = stagesRaw as StageInput[];

    const teamCount = await prisma.team.count({ where: { tournamentId, isDeleted: false } });

    // Compute teamsAdvancing for each stage sequentially so KNOCKOUT stages
    // can derive their value as Math.floor(incoming / 2).
    let prevIncoming: number | null = teamCount > 0 ? teamCount : null;
    const teamsAdvancingValues: (number | null)[] = inputs.map((entry) => {
      let value: number | null;
      if (entry.type === StageType.GROUP) {
        value = entry.numberOfGroups! * entry.teamsAdvancingPerGroup!;
      } else if (entry.type === StageType.KNOCKOUT) {
        value = prevIncoming !== null ? Math.floor(prevIncoming / 2) : null;
      } else {
        value = entry.teamsAdvancing ?? null;
      }
      prevIncoming = value;
      return value;
    });

    const created = await prisma.$transaction(
      inputs.map((entry, i) => {
        return prisma.tournamentStage.create({
          data: {
            tournamentId,
            type: entry.type,
            order: i + 1,
            name: DEFAULT_NAMES[entry.type],
            teamsAdvancing: teamsAdvancingValues[i],
            numberOfGroups: entry.numberOfGroups ?? null,
            teamsAdvancingPerGroup: entry.teamsAdvancingPerGroup ?? null,
          },
          select: {
            id: true,
            type: true,
            order: true,
            name: true,
            status: true,
            teamsAdvancing: true,
            numberOfGroups: true,
            teamsAdvancingPerGroup: true,
          },
        });
      }),
    );

    const sorted = created.sort((a, b) => a.order - b.order);
    res.status(201).json({ message: "Stages created successfully", data: sorted });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create stages" });
  }
}
