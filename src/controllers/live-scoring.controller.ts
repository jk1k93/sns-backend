import type { Request, Response } from "express";
import { FixtureStatus, InningsStatus, LineupParticipationType, TossChoice } from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";
import { assertTournamentAccess, fixtureSelect } from "./fixture.controller.js";

// POST /tournaments/:id/fixtures/:fixtureId/toss
export async function declareToss(req: Request, res: Response): Promise<void> {
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

  const tossWinnerId: string | undefined = req.body?.tossWinnerId;
  const tossChoiceRaw: string | undefined = req.body?.tossChoice;
  const oversPerInningsRaw: number | undefined = req.body?.oversPerInnings;
  const freeHitEnabledRaw: boolean | undefined = req.body?.freeHitEnabled;

  if (!tossWinnerId || !isUuid(tossWinnerId)) {
    res.status(400).json({ error: "tossWinnerId is required and must be a valid UUID" });
    return;
  }
  if (tossChoiceRaw !== TossChoice.BAT && tossChoiceRaw !== TossChoice.BOWL) {
    res.status(400).json({ error: "tossChoice must be BAT or BOWL" });
    return;
  }
  const tossChoice: TossChoice = tossChoiceRaw;

  if (oversPerInningsRaw !== undefined && (!Number.isInteger(oversPerInningsRaw) || oversPerInningsRaw <= 0)) {
    res.status(400).json({ error: "oversPerInnings must be a positive integer" });
    return;
  }
  if (freeHitEnabledRaw !== undefined && typeof freeHitEnabledRaw !== "boolean") {
    res.status(400).json({ error: "freeHitEnabled must be a boolean" });
    return;
  }

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
        status: true,
        cricketInnings: {
          where: { isDeleted: false },
          select: { inningsNumber: true, status: true },
        },
      },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }
    if (fixture.isBye) {
      res.status(400).json({ error: "Cannot start a live match for a bye fixture" });
      return;
    }
    if (!fixture.homeTeamId || !fixture.awayTeamId) {
      res.status(400).json({ error: "Both teams must be assigned before starting the match" });
      return;
    }
    if (fixture.status === FixtureStatus.COMPLETED || fixture.status === FixtureStatus.CANCELLED) {
      res.status(400).json({ error: "Cannot declare or update the toss for a completed or cancelled fixture" });
      return;
    }
    // Re-declaring (a re-toss, or fixing a mistake) is allowed for as long as no ball
    // has actually been recorded yet — once an innings is under way this endpoint no
    // longer applies, since a new toss would invalidate deliveries already scored.
    const scoringStarted = fixture.cricketInnings.some((inn) => inn.status !== InningsStatus.NOT_STARTED);
    if (scoringStarted) {
      res.status(400).json({ error: "Cannot change the toss after scoring has started" });
      return;
    }
    if (tossWinnerId !== fixture.homeTeamId && tossWinnerId !== fixture.awayTeamId) {
      res.status(400).json({ error: "tossWinnerId must be one of the fixture's two teams" });
      return;
    }

    const config = await prisma.cricketTournamentConfig.findUnique({
      where: { tournamentId },
      select: { oversPerInnings: true, freeHitEnabled: true, isDeleted: true },
    });
    if (!config || config.isDeleted) {
      res.status(400).json({ error: "Tournament has no cricket config set up" });
      return;
    }

    const oversPerInnings = oversPerInningsRaw ?? config.oversPerInnings;
    const freeHitEnabled = freeHitEnabledRaw ?? config.freeHitEnabled;

    const otherTeamId = tossWinnerId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    const battingTeamId = tossChoice === TossChoice.BAT ? tossWinnerId : otherTeamId;
    const bowlingTeamId = battingTeamId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.fixture.update({
        where: { id: fixtureId },
        data: {
          status: FixtureStatus.IN_PROGRESS,
          oversPerInnings,
          freeHitEnabled,
        },
      });

      await tx.cricketMatchResult.upsert({
        where: { fixtureId },
        create: {
          fixtureId,
          homeRuns: 0, homeWickets: 0, homeBalls: 0,
          awayRuns: 0, awayWickets: 0, awayBalls: 0,
          tossWinnerId, tossChoice,
        },
        update: { tossWinnerId, tossChoice },
      });

      await tx.cricketInnings.upsert({
        where: { fixtureId_inningsNumber: { fixtureId, inningsNumber: 1 } },
        create: {
          fixtureId,
          inningsNumber: 1,
          battingTeamId,
          bowlingTeamId,
          oversLimit: oversPerInnings,
          status: InningsStatus.NOT_STARTED,
          target: null,
        },
        update: {
          battingTeamId,
          bowlingTeamId,
          oversLimit: oversPerInnings,
        },
      });

      return tx.fixture.findUniqueOrThrow({ where: { id: fixtureId }, select: fixtureSelect });
    });

    res.status(200).json({ message: "Toss recorded and match started", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to record toss" });
  }
}

// PATCH /tournaments/:id/fixtures/:fixtureId/innings/:inningsId/start
export async function startInnings(req: Request, res: Response): Promise<void> {
  const tournamentId = paramId(req.params.id);
  const fixtureId = paramId(req.params.fixtureId);
  const inningsId = paramId(req.params.inningsId);
  if (!tournamentId || !isUuid(tournamentId)) {
    res.status(400).json({ error: "Invalid tournament id" });
    return;
  }
  if (!fixtureId || !isUuid(fixtureId)) {
    res.status(400).json({ error: "Invalid fixture id" });
    return;
  }
  if (!inningsId || !isUuid(inningsId)) {
    res.status(400).json({ error: "Invalid innings id" });
    return;
  }

  const userId = req.auth!.userId;
  const accessError = await assertTournamentAccess(tournamentId, userId);
  if (accessError) {
    res.status(accessError.status).json({ error: accessError.error });
    return;
  }

  const strikerId: string | undefined = req.body?.strikerId;
  const nonStrikerId: string | undefined = req.body?.nonStrikerId;
  const bowlerId: string | undefined = req.body?.bowlerId;

  if (!strikerId || !isUuid(strikerId)) {
    res.status(400).json({ error: "strikerId is required and must be a valid UUID" });
    return;
  }
  if (!nonStrikerId || !isUuid(nonStrikerId)) {
    res.status(400).json({ error: "nonStrikerId is required and must be a valid UUID" });
    return;
  }
  if (!bowlerId || !isUuid(bowlerId)) {
    res.status(400).json({ error: "bowlerId is required and must be a valid UUID" });
    return;
  }
  if (strikerId === nonStrikerId) {
    res.status(400).json({ error: "strikerId and nonStrikerId must be different players" });
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

    const innings = await prisma.cricketInnings.findUnique({
      where: { id: inningsId },
      select: {
        id: true,
        fixtureId: true,
        isDeleted: true,
        status: true,
        battingTeamId: true,
        bowlingTeamId: true,
      },
    });
    if (!innings || innings.isDeleted || innings.fixtureId !== fixtureId) {
      res.status(404).json({ error: "Innings not found" });
      return;
    }
    if (innings.status === InningsStatus.COMPLETED) {
      res.status(400).json({ error: "This innings has already ended" });
      return;
    }

    // Re-picking openers/bowler (fixing a mistake) is allowed for as long as no ball
    // has actually been recorded yet.
    const deliveryCount = await prisma.cricketDelivery.count({ where: { inningsId } });
    if (deliveryCount > 0) {
      res.status(400).json({ error: "Cannot change openers or bowler after scoring has started" });
      return;
    }

    const lineup = await prisma.cricketFixtureLineUp.findMany({
      where: { fixtureId, isDeleted: false, participationType: LineupParticipationType.STARTING },
      select: { tournamentPlayerId: true, teamId: true },
    });
    const battingStarters = new Set(
      lineup.filter((l) => l.teamId === innings.battingTeamId).map((l) => l.tournamentPlayerId),
    );
    const bowlingStarters = new Set(
      lineup.filter((l) => l.teamId === innings.bowlingTeamId).map((l) => l.tournamentPlayerId),
    );

    if (!battingStarters.has(strikerId)) {
      res.status(400).json({ error: "strikerId must be one of the batting team's starting XI" });
      return;
    }
    if (!battingStarters.has(nonStrikerId)) {
      res.status(400).json({ error: "nonStrikerId must be one of the batting team's starting XI" });
      return;
    }
    if (!bowlingStarters.has(bowlerId)) {
      res.status(400).json({ error: "bowlerId must be one of the bowling team's starting XI" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cricketInnings.update({
        where: { id: inningsId },
        data: {
          status: InningsStatus.IN_PROGRESS,
          currentStrikerId: strikerId,
          currentNonStrikerId: nonStrikerId,
          currentBowlerId: bowlerId,
        },
      });

      return tx.fixture.findUniqueOrThrow({ where: { id: fixtureId }, select: fixtureSelect });
    });

    res.status(200).json({ message: "Innings started", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to start innings" });
  }
}
