import type { Request, Response } from "express";
import { StageType, FixtureStatus, StageStatus, TossChoice } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";
import { parseDate } from "../helpers/date.helper.js";

const fixtureSelect = {
  id: true,
  tournamentId: true,
  stageId: true,
  groupId: true,
  group: { select: { name: true } },
  homeTeamId: true,
  homeTeam: { select: { id: true, name: true, shortCode: true } },
  awayTeamId: true,
  awayTeam: { select: { id: true, name: true, shortCode: true } },
  winnerId: true,
  winner: { select: { id: true, name: true, shortCode: true } },
  roundNumber: true,
  scheduledAt: true,
  status: true,
  cricketMatchResult: {
    select: {
      homeRuns: true, homeWickets: true, homeBalls: true,
      awayRuns: true, awayWickets: true, awayBalls: true,
      tossWinnerId: true, tossChoice: true,
    },
  },
} as const;

const bracketFixtureSelect = {
  id: true,
  tournamentId: true,
  stageId: true,
  roundNumber: true,
  homeTeamId: true,
  homeTeam: { select: { id: true, name: true, shortCode: true } },
  awayTeamId: true,
  awayTeam: { select: { id: true, name: true, shortCode: true } },
  homeTeamSlot: true,
  awayTeamSlot: true,
  winnerId: true,
  winner: { select: { id: true, name: true, shortCode: true } },
  isBye: true,
  byeTeamId: true,
  byeTeam: { select: { id: true, name: true, shortCode: true } },
  status: true,
  scheduledAt: true,
} as const;

function bracketRoundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi Finals";
  if (fromEnd === 2) return "Quarter Finals";
  if (fromEnd === 3) return "Round of 16";
  if (fromEnd === 4) return "Round of 32";
  return `Round ${round}`;
}

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

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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
      select: { id: true, tournamentId: true, isDeleted: true, type: true, order: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    if (stage.type === StageType.GROUP) {
      res.status(400).json({ error: "Group stages use the group-draw endpoint instead" });
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

    if (stage.type === StageType.ROUND_ROBIN) {
      const teams = await prisma.team.findMany({
        where: { tournamentId, isDeleted: false },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (teams.length < 2) {
        res.status(400).json({ error: "At least 2 teams are required to generate fixtures" });
        return;
      }

      const pairs = roundRobinPairs(shuffle(teams.map((t) => t.id)));

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
      return;
    }

    // Knockout fixtures are drawn manually — use POST /stages/:stageId/fixtures
    res.status(400).json({ error: "Knockout fixtures must be drawn manually. Use POST /stages/:stageId/fixtures to create each fixture." });
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
      select: { id: true, tournamentId: true, isDeleted: true, type: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }

    if (stage.type === StageType.GROUP) {
      await prisma.$transaction([
        prisma.fixture.updateMany({ where: { stageId, isDeleted: false }, data: { isDeleted: true } }),
        prisma.groupTeam.updateMany({ where: { group: { stageId, isDeleted: false }, isDeleted: false }, data: { isDeleted: true } }),
        prisma.group.updateMany({ where: { stageId, isDeleted: false }, data: { isDeleted: true } }),
      ]);
    } else {
      await prisma.fixture.updateMany({
        where: { stageId, isDeleted: false },
        data: { isDeleted: true },
      });
    }

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
    const stageIds = await prisma.tournamentStage
      .findMany({ where: { tournamentId, isDeleted: false }, select: { id: true } })
      .then((rows) => rows.map((r) => r.id));

    await prisma.$transaction([
      prisma.fixture.updateMany({ where: { tournamentId, isDeleted: false }, data: { isDeleted: true } }),
      prisma.groupTeam.updateMany({ where: { group: { stageId: { in: stageIds }, isDeleted: false }, isDeleted: false }, data: { isDeleted: true } }),
      prisma.group.updateMany({ where: { stageId: { in: stageIds }, isDeleted: false }, data: { isDeleted: true } }),
      prisma.tournamentStage.updateMany({ where: { tournamentId, isDeleted: false }, data: { isDeleted: true } }),
    ]);

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

  const { scheduledAt: scheduledAtRaw, homeTeamId: homeTeamIdRaw, awayTeamId: awayTeamIdRaw } = req.body ?? {};

  if (scheduledAtRaw === undefined && homeTeamIdRaw === undefined && awayTeamIdRaw === undefined) {
    res.status(400).json({ error: "At least one of scheduledAt, homeTeamId, or awayTeamId is required" });
    return;
  }

  let scheduledAtValue: Date | null | undefined = undefined;
  if (scheduledAtRaw !== undefined) {
    if (scheduledAtRaw === null) {
      scheduledAtValue = null;
    } else {
      const parsed = parseDate(scheduledAtRaw, "scheduledAt");
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      scheduledAtValue = parsed.value;
    }
  }

  if (homeTeamIdRaw !== undefined && homeTeamIdRaw !== null && !isUuid(homeTeamIdRaw)) {
    res.status(400).json({ error: "homeTeamId must be a valid UUID" });
    return;
  }
  if (awayTeamIdRaw !== undefined && awayTeamIdRaw !== null && !isUuid(awayTeamIdRaw)) {
    res.status(400).json({ error: "awayTeamId must be a valid UUID" });
    return;
  }

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: {
        id: true,
        tournamentId: true,
        stageId: true,
        isDeleted: true,
        status: true,
        homeTeamId: true,
        awayTeamId: true,
        stage: { select: { type: true } },
      },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }

    const wantsTeamAssignment = homeTeamIdRaw !== undefined || awayTeamIdRaw !== undefined;
    if (wantsTeamAssignment) {
      if (fixture.stage.type !== StageType.KNOCKOUT) {
        res.status(400).json({ error: "Team assignment is only allowed for knockout stage fixtures" });
        return;
      }
      if (fixture.status === FixtureStatus.IN_PROGRESS || fixture.status === FixtureStatus.COMPLETED) {
        res.status(400).json({ error: "Cannot reassign teams for a fixture that is in progress or completed" });
        return;
      }
      if (homeTeamIdRaw !== null && homeTeamIdRaw !== undefined) {
        const team = await prisma.team.findFirst({
          where: { id: homeTeamIdRaw, tournamentId, isDeleted: false },
          select: { id: true },
        });
        if (!team) {
          res.status(400).json({ error: "Home team not found in this tournament" });
          return;
        }
      }
      if (awayTeamIdRaw !== null && awayTeamIdRaw !== undefined) {
        const team = await prisma.team.findFirst({
          where: { id: awayTeamIdRaw, tournamentId, isDeleted: false },
          select: { id: true },
        });
        if (!team) {
          res.status(400).json({ error: "Away team not found in this tournament" });
          return;
        }
      }
    }

    const updateData: {
      scheduledAt?: Date | null;
      homeTeamId?: string | null;
      awayTeamId?: string | null;
    } = {};
    if (scheduledAtValue !== undefined) updateData.scheduledAt = scheduledAtValue;
    if (homeTeamIdRaw !== undefined) updateData.homeTeamId = homeTeamIdRaw ?? null;
    if (awayTeamIdRaw !== undefined) updateData.awayTeamId = awayTeamIdRaw ?? null;

    const updated = await prisma.fixture.update({
      where: { id: fixtureId },
      data: updateData,
      select: fixtureSelect,
    });

    res.status(200).json({ message: "Fixture updated successfully", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update fixture" });
  }
}

const GROUP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function groupDraw(req: Request, res: Response): Promise<void> {
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

  const { mode, groups: manualGroups } = req.body ?? {};
  if (mode !== "random" && mode !== "manual") {
    res.status(400).json({ error: "mode must be 'random' or 'manual'" });
    return;
  }

  try {
    const stage = await prisma.tournamentStage.findUnique({
      where: { id: stageId },
      select: { id: true, tournamentId: true, isDeleted: true, type: true, numberOfGroups: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    if (stage.type !== StageType.GROUP) {
      res.status(400).json({ error: "Only Group stages support group draw" });
      return;
    }
    const n = stage.numberOfGroups;
    if (!n || n < 2) {
      res.status(400).json({ error: "Stage has no valid numberOfGroups configured" });
      return;
    }

    const existingGroup = await prisma.group.findFirst({
      where: { stageId, isDeleted: false },
      select: { id: true },
    });
    if (existingGroup) {
      res.status(409).json({ error: "Group draw already performed for this stage" });
      return;
    }

    const teams = await prisma.team.findMany({
      where: { tournamentId, isDeleted: false },
      select: { id: true, name: true, shortCode: true },
      orderBy: { createdAt: "asc" },
    });
    if (teams.length < n) {
      res.status(400).json({ error: `Need at least ${n} teams to fill ${n} groups` });
      return;
    }

    let groupAssignments: string[][];

    if (mode === "random") {
      const shuffled = shuffle(teams.map((t) => t.id));
      groupAssignments = Array.from({ length: n }, () => [] as string[]);
      shuffled.forEach((id, idx) => groupAssignments[idx % n].push(id));
    } else {
      if (!Array.isArray(manualGroups) || manualGroups.length !== n) {
        res.status(400).json({ error: `groups must be an array of exactly ${n} objects` });
        return;
      }
      const teamIdSet = new Set(teams.map((t) => t.id));
      const seen = new Set<string>();
      groupAssignments = [];
      for (let i = 0; i < n; i++) {
        const g = manualGroups[i];
        if (!g || !Array.isArray(g.teamIds)) {
          res.status(400).json({ error: `groups[${i}].teamIds must be an array` });
          return;
        }
        const ids: string[] = [];
        for (const tid of g.teamIds as string[]) {
          if (typeof tid !== "string" || !isUuid(tid)) {
            res.status(400).json({ error: `groups[${i}] contains invalid team id` });
            return;
          }
          if (!teamIdSet.has(tid)) {
            res.status(400).json({ error: `Team ${tid} does not belong to this tournament` });
            return;
          }
          if (seen.has(tid)) {
            res.status(400).json({ error: `Team ${tid} appears in multiple groups` });
            return;
          }
          seen.add(tid);
          ids.push(tid);
        }
        groupAssignments.push(ids);
      }
    }

    const teamMap = new Map(teams.map((t) => [t.id, t]));

    const result = await prisma.$transaction(async (tx) => {
      const groups = [];
      for (let i = 0; i < n; i++) {
        const groupName = `Group ${GROUP_LETTERS[i] ?? String(i + 1)}`;
        const group = await tx.group.create({
          data: { stageId, name: groupName, order: i + 1 },
          select: { id: true, name: true, order: true },
        });

        const teamIds = groupAssignments[i];
        if (teamIds.length > 0) {
          await tx.groupTeam.createMany({
            data: teamIds.map((teamId, pos) => ({
              groupId: group.id,
              teamId,
              drawPosition: pos + 1,
            })),
          });
        }

        const pairs = roundRobinPairs(teamIds);
        if (pairs.length > 0) {
          await tx.fixture.createMany({
            data: pairs.map(([homeTeamId, awayTeamId]) => ({
              tournamentId,
              stageId,
              groupId: group.id,
              homeTeamId,
              awayTeamId,
            })),
          });
        }

        groups.push({
          ...group,
          teams: teamIds.map((id, pos) => ({ ...teamMap.get(id)!, drawPosition: pos + 1 })),
          fixtureCount: pairs.length,
        });
      }
      return groups;
    });

    res.status(201).json({ message: "Group draw completed successfully", data: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to perform group draw" });
  }
}

export async function deleteKnockoutFixture(req: Request, res: Response): Promise<void> {
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

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: {
        id: true,
        tournamentId: true,
        isDeleted: true,
        status: true,
        stage: { select: { type: true } },
      },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }
    if (fixture.stage.type !== StageType.KNOCKOUT) {
      res.status(400).json({ error: "Only knockout fixtures can be deleted individually" });
      return;
    }
    if (fixture.status !== FixtureStatus.SCHEDULED) {
      res.status(400).json({ error: "Only scheduled fixtures can be deleted" });
      return;
    }

    await prisma.fixture.update({ where: { id: fixtureId }, data: { isDeleted: true } });

    res.status(200).json({ message: "Fixture deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete fixture" });
  }
}

export async function createKnockoutFixture(req: Request, res: Response): Promise<void> {
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

  const { homeTeamId, awayTeamId, roundNumber: roundNumberRaw, scheduledAt: scheduledAtRaw } = req.body ?? {};

  if (!homeTeamId || !isUuid(homeTeamId)) {
    res.status(400).json({ error: "homeTeamId must be a valid UUID" });
    return;
  }
  if (!awayTeamId || !isUuid(awayTeamId)) {
    res.status(400).json({ error: "awayTeamId must be a valid UUID" });
    return;
  }
  if (homeTeamId === awayTeamId) {
    res.status(400).json({ error: "homeTeamId and awayTeamId must be different teams" });
    return;
  }

  const roundNumber =
    roundNumberRaw === undefined ? 1 : typeof roundNumberRaw === "number" && Number.isInteger(roundNumberRaw) && roundNumberRaw >= 1
      ? roundNumberRaw
      : null;
  if (roundNumber === null) {
    res.status(400).json({ error: "roundNumber must be a positive integer" });
    return;
  }

  let scheduledAtValue: Date | null | undefined;
  if (scheduledAtRaw !== undefined) {
    if (scheduledAtRaw === null) {
      scheduledAtValue = null;
    } else {
      const parsed = parseDate(scheduledAtRaw, "scheduledAt");
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      scheduledAtValue = parsed.value;
    }
  }

  try {
    const stage = await prisma.tournamentStage.findUnique({
      where: { id: stageId },
      select: { id: true, tournamentId: true, isDeleted: true, type: true, order: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    if (stage.type !== StageType.KNOCKOUT) {
      res.status(400).json({ error: "Manual fixture draw is only available for knockout stages" });
      return;
    }

    const [homeTeam, awayTeam] = await Promise.all([
      prisma.team.findFirst({ where: { id: homeTeamId, tournamentId, isDeleted: false }, select: { id: true } }),
      prisma.team.findFirst({ where: { id: awayTeamId, tournamentId, isDeleted: false }, select: { id: true } }),
    ]);
    if (!homeTeam) {
      res.status(400).json({ error: "Home team not found in this tournament" });
      return;
    }
    if (!awayTeam) {
      res.status(400).json({ error: "Away team not found in this tournament" });
      return;
    }

    if (stage.order > 1) {
      const prevStage = await prisma.tournamentStage.findFirst({
        where: { tournamentId, order: stage.order - 1, isDeleted: false },
        select: { id: true, type: true, status: true },
      });
      if (prevStage?.type === StageType.KNOCKOUT && prevStage.status === StageStatus.COMPLETED) {
        const prevFixtures = await prisma.fixture.findMany({
          where: { stageId: prevStage.id, isDeleted: false },
          select: { isBye: true, byeTeamId: true, winnerId: true },
        });
        const eligibleIds = new Set<string>();
        for (const f of prevFixtures) {
          if (f.isBye && f.byeTeamId) eligibleIds.add(f.byeTeamId);
          else if (f.winnerId) eligibleIds.add(f.winnerId);
        }
        if (!eligibleIds.has(homeTeamId)) {
          res.status(400).json({ error: "Home team did not advance from the previous stage" });
          return;
        }
        if (!eligibleIds.has(awayTeamId)) {
          res.status(400).json({ error: "Away team did not advance from the previous stage" });
          return;
        }
      }
    }

    const fixture = await prisma.fixture.create({
      data: {
        tournamentId,
        stageId,
        homeTeamId,
        awayTeamId,
        roundNumber,
        ...(scheduledAtValue !== undefined ? { scheduledAt: scheduledAtValue } : {}),
      },
      select: bracketFixtureSelect,
    });

    res.status(201).json({ message: "Fixture created successfully", data: fixture });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create fixture" });
  }
}

export async function getEligibleTeams(req: Request, res: Response): Promise<void> {
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
      select: { id: true, tournamentId: true, isDeleted: true, order: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }

    const teamSelect = { id: true, name: true, shortCode: true, logoUrl: true } as const;

    if (stage.order === 1) {
      const teams = await prisma.team.findMany({
        where: { tournamentId, isDeleted: false },
        select: teamSelect,
        orderBy: { createdAt: "asc" },
      });
      res.status(200).json({ message: "Eligible teams fetched successfully", data: teams });
      return;
    }

    const prevStage = await prisma.tournamentStage.findFirst({
      where: { tournamentId, order: stage.order - 1, isDeleted: false },
      select: { id: true, type: true, status: true, teamsAdvancing: true, teamsAdvancingPerGroup: true },
    });

    if (!prevStage) {
      const teams = await prisma.team.findMany({
        where: { tournamentId, isDeleted: false },
        select: teamSelect,
        orderBy: { createdAt: "asc" },
      });
      res.status(200).json({ message: "Eligible teams fetched successfully", data: teams });
      return;
    }

    if (prevStage.status !== StageStatus.COMPLETED) {
      res.status(400).json({ error: "Previous stage is not yet completed" });
      return;
    }

    if (prevStage.type === StageType.ROUND_ROBIN) {
      const fixtures = await prisma.fixture.findMany({
        where: { stageId: prevStage.id, isDeleted: false, isBye: false },
        select: fixtureResultSelect,
      });
      const sorted = sortStandings([...buildStandingsMap(fixtures).values()]);
      const topN = prevStage.teamsAdvancing ?? sorted.length;
      res.status(200).json({
        message: "Eligible teams fetched successfully",
        data: sorted.slice(0, topN).map((s) => s.team),
      });
      return;
    }

    if (prevStage.type === StageType.GROUP) {
      const [fixtures, groups] = await Promise.all([
        prisma.fixture.findMany({
          where: { stageId: prevStage.id, isDeleted: false, isBye: false },
          select: fixtureResultSelect,
        }),
        prisma.group.findMany({
          where: { stageId: prevStage.id, isDeleted: false },
          orderBy: { order: "asc" },
          select: { id: true },
        }),
      ]);
      const topN = prevStage.teamsAdvancingPerGroup ?? 1;
      const advancingTeams: { id: string; name: string; shortCode: string | null; logoUrl: string | null }[] = [];
      for (const g of groups) {
        const sorted = sortStandings([
          ...buildStandingsMap(fixtures.filter((f) => f.groupId === g.id)).values(),
        ]);
        advancingTeams.push(...sorted.slice(0, topN).map((s) => s.team));
      }
      res.status(200).json({ message: "Eligible teams fetched successfully", data: advancingTeams });
      return;
    }

    // KNOCKOUT previous stage — status already confirmed COMPLETED above
    const prevFixtures = await prisma.fixture.findMany({
      where: { stageId: prevStage.id, isDeleted: false },
      select: {
        isBye: true,
        byeTeamId: true,
        byeTeam: { select: teamSelect },
        winnerId: true,
        winner: { select: teamSelect },
      },
    });

    const teams: { id: string; name: string; shortCode: string | null; logoUrl: string | null }[] = [];
    for (const f of prevFixtures) {
      if (f.isBye && f.byeTeam) {
        teams.push(f.byeTeam);
      } else if (f.winner) {
        teams.push(f.winner);
      }
    }

    res.status(200).json({ message: "Eligible teams fetched successfully", data: teams });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch eligible teams" });
  }
}

export async function getBracket(req: Request, res: Response): Promise<void> {
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
      select: { id: true, tournamentId: true, isDeleted: true, type: true },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    if (stage.type !== StageType.KNOCKOUT) {
      res.status(400).json({ error: "Bracket is only available for knockout stages" });
      return;
    }

    const fixtures = await prisma.fixture.findMany({
      where: { stageId, isDeleted: false },
      select: bracketFixtureSelect,
      orderBy: [{ roundNumber: "asc" }, { createdAt: "asc" }],
    });

    if (fixtures.length === 0) {
      res.status(200).json({ message: "Bracket fetched successfully", data: { totalRounds: 0, rounds: [] } });
      return;
    }

    const totalRounds = Math.max(...fixtures.map((f) => f.roundNumber));

    const roundMap = new Map<number, typeof fixtures>();
    for (const f of fixtures) {
      const bucket = roundMap.get(f.roundNumber) ?? [];
      bucket.push(f);
      roundMap.set(f.roundNumber, bucket);
    }

    const rounds = Array.from(roundMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, roundFixtures]) => ({
        round,
        name: bracketRoundName(round, totalRounds),
        fixtures: roundFixtures,
      }));

    res.status(200).json({ message: "Bracket fetched successfully", data: { totalRounds, rounds } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch bracket" });
  }
}

export async function listGroups(req: Request, res: Response): Promise<void> {
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

    const groups = await prisma.group.findMany({
      where: { stageId, isDeleted: false },
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        order: true,
        groupTeams: {
          where: { isDeleted: false },
          orderBy: { drawPosition: "asc" },
          select: {
            drawPosition: true,
            seed: true,
            team: { select: { id: true, name: true, shortCode: true, logoUrl: true } },
          },
        },
      },
    });

    res.status(200).json({ message: "Groups fetched successfully", data: groups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
}

// --- Standings helpers ---

type TeamStanding = {
  teamId: string;
  team: { id: string; name: string; shortCode: string | null; logoUrl: string | null };
  played: number;
  won: number;
  lost: number;
  tied: number;
  points: number;
  runsScored: number;
  runsConceded: number;
  ballsFaced: number;
  ballsBowled: number;
  nrr: number;
};

const fixtureResultSelect = {
  groupId: true,
  homeTeamId: true,
  awayTeamId: true,
  homeTeam: { select: { id: true, name: true, shortCode: true, logoUrl: true } },
  awayTeam: { select: { id: true, name: true, shortCode: true, logoUrl: true } },
  winnerId: true,
  status: true,
  cricketMatchResult: {
    select: { homeRuns: true, homeBalls: true, awayRuns: true, awayBalls: true },
  },
} as const;

function buildStandingsMap(
  fixtures: Array<{
    groupId: string | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeTeam: { id: string; name: string; shortCode: string | null; logoUrl: string | null } | null;
    awayTeam: { id: string; name: string; shortCode: string | null; logoUrl: string | null } | null;
    winnerId: string | null;
    status: FixtureStatus;
    cricketMatchResult: { homeRuns: number; homeBalls: number; awayRuns: number; awayBalls: number } | null;
  }>,
): Map<string, TeamStanding> {
  const map = new Map<string, TeamStanding>();

  const ensure = (
    team: { id: string; name: string; shortCode: string | null; logoUrl: string | null },
  ): TeamStanding => {
    if (!map.has(team.id)) {
      map.set(team.id, {
        teamId: team.id, team,
        played: 0, won: 0, lost: 0, tied: 0, points: 0,
        runsScored: 0, runsConceded: 0, ballsFaced: 0, ballsBowled: 0, nrr: 0,
      });
    }
    return map.get(team.id)!;
  };

  for (const f of fixtures) {
    if (!f.homeTeam || !f.awayTeam) continue;

    const home = ensure(f.homeTeam);
    const away = ensure(f.awayTeam);

    if (!f.cricketMatchResult || f.status !== FixtureStatus.COMPLETED) continue;

    const r = f.cricketMatchResult;

    home.runsScored += r.homeRuns;
    home.ballsFaced += r.homeBalls;
    home.runsConceded += r.awayRuns;
    home.ballsBowled += r.awayBalls;

    away.runsScored += r.awayRuns;
    away.ballsFaced += r.awayBalls;
    away.runsConceded += r.homeRuns;
    away.ballsBowled += r.homeBalls;

    home.played++;
    away.played++;

    if (f.winnerId === f.homeTeamId) {
      home.won++; home.points += 2; away.lost++;
    } else if (f.winnerId === f.awayTeamId) {
      away.won++; away.points += 2; home.lost++;
    } else {
      home.tied++; home.points += 1;
      away.tied++; away.points += 1;
    }
  }

  for (const s of map.values()) {
    const rr = s.ballsFaced > 0 ? s.runsScored / (s.ballsFaced / 6) : 0;
    const ra = s.ballsBowled > 0 ? s.runsConceded / (s.ballsBowled / 6) : 0;
    s.nrr = parseFloat((rr - ra).toFixed(3));
  }

  return map;
}

function sortStandings(standings: TeamStanding[]): TeamStanding[] {
  return standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.nrr !== a.nrr) return b.nrr - a.nrr;
    return a.team.name.localeCompare(b.team.name);
  });
}

// POST /tournaments/:id/fixtures/:fixtureId/result
export async function submitCricketResult(req: Request, res: Response): Promise<void> {
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

  const homeRuns: number = req.body?.homeRuns;
  const homeWickets: number = req.body?.homeWickets;
  const homeBalls: number = req.body?.homeBalls;
  const awayRuns: number = req.body?.awayRuns;
  const awayWickets: number = req.body?.awayWickets;
  const awayBalls: number = req.body?.awayBalls;
  const tossWinnerIdRaw: string | null | undefined = req.body?.tossWinnerId ?? null;
  const tossChoiceRaw: string | null | undefined = req.body?.tossChoice ?? null;

  const scoreFields: [string, number][] = [
    ["homeRuns", homeRuns], ["homeWickets", homeWickets], ["homeBalls", homeBalls],
    ["awayRuns", awayRuns], ["awayWickets", awayWickets], ["awayBalls", awayBalls],
  ];
  for (const [name, val] of scoreFields) {
    if (!Number.isInteger(val) || val < 0) {
      res.status(400).json({ error: `${name} must be a non-negative integer` });
      return;
    }
  }

  if (tossWinnerIdRaw !== null && tossWinnerIdRaw !== undefined && !isUuid(tossWinnerIdRaw)) {
    res.status(400).json({ error: "tossWinnerId must be a valid UUID or null" });
    return;
  }
  if (tossChoiceRaw !== null && tossChoiceRaw !== TossChoice.BAT && tossChoiceRaw !== TossChoice.BOWL) {
    res.status(400).json({ error: "tossChoice must be BAT, BOWL, or null" });
    return;
  }
  const tossChoice: TossChoice | null = tossChoiceRaw === TossChoice.BAT ? TossChoice.BAT
    : tossChoiceRaw === TossChoice.BOWL ? TossChoice.BOWL
    : null;

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: {
        id: true,
        tournamentId: true,
        stageId: true,
        homeTeamId: true,
        awayTeamId: true,
        isDeleted: true,
        isBye: true,
      },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }
    if (fixture.isBye) {
      res.status(400).json({ error: "Cannot record result for a bye fixture" });
      return;
    }
    if (!fixture.homeTeamId || !fixture.awayTeamId) {
      res.status(400).json({ error: "Both teams must be assigned before recording a result" });
      return;
    }

    let winnerId: string | null = null;
    if (homeRuns > awayRuns) winnerId = fixture.homeTeamId;
    else if (awayRuns > homeRuns) winnerId = fixture.awayTeamId;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cricketMatchResult.upsert({
        where: { fixtureId },
        create: { fixtureId, homeRuns, homeWickets, homeBalls, awayRuns, awayWickets, awayBalls, tossWinnerId: tossWinnerIdRaw, tossChoice },
        update: { homeRuns, homeWickets, homeBalls, awayRuns, awayWickets, awayBalls, tossWinnerId: tossWinnerIdRaw, tossChoice },
      });

      const result = await tx.fixture.update({
        where: { id: fixtureId },
        data: { status: FixtureStatus.COMPLETED, winnerId },
        select: fixtureSelect,
      });

      const [total, completed] = await Promise.all([
        tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false } }),
        tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false, status: FixtureStatus.COMPLETED } }),
      ]);

      const newStageStatus =
        total > 0 && completed === total
          ? StageStatus.COMPLETED
          : completed > 0
            ? StageStatus.IN_PROGRESS
            : StageStatus.PENDING;

      await tx.tournamentStage.update({
        where: { id: fixture.stageId },
        data: { status: newStageStatus },
      });

      return result;
    });

    res.status(200).json({ message: "Result recorded successfully", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to record result" });
  }
}

// GET /tournaments/:id/stages/:stageId/standings
export async function getStandings(req: Request, res: Response): Promise<void> {
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
      select: {
        id: true,
        tournamentId: true,
        isDeleted: true,
        type: true,
        teamsAdvancingPerGroup: true,
      },
    });
    if (!stage || stage.isDeleted || stage.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    if (stage.type === StageType.KNOCKOUT) {
      res.status(400).json({ error: "Standings are not available for knockout stages" });
      return;
    }

    const fixtures = await prisma.fixture.findMany({
      where: { stageId, isDeleted: false, isBye: false },
      select: fixtureResultSelect,
    });

    if (stage.type === StageType.GROUP) {
      const groups = await prisma.group.findMany({
        where: { stageId, isDeleted: false },
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true },
      });

      const data = groups.map((g) => ({
        groupId: g.id,
        groupName: g.name,
        standings: sortStandings([...buildStandingsMap(fixtures.filter((f) => f.groupId === g.id)).values()]),
      }));

      res.status(200).json({ message: "Standings fetched successfully", data });
      return;
    }

    res.status(200).json({
      message: "Standings fetched successfully",
      data: sortStandings([...buildStandingsMap(fixtures).values()]),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch standings" });
  }
}
