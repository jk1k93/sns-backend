import type { Request, Response } from "express";
import {
  ExtraType,
  FixtureStatus,
  InningsStatus,
  LineupParticipationType,
  StageStatus,
  TossChoice,
  WicketType,
} from "../../generated/prisma/client.js";
import { prisma } from "../db.js";
import { isUuid, paramId } from "../helpers/query.helper.js";
import {
  replayInnings,
  type DeliveryForReplay,
  type InningsState,
} from "../helpers/cricket-innings.helper.js";
import { assertTournamentAccess, fixtureSelect } from "./fixture.controller.js";

const EXTRA_TYPES = new Set<string>(Object.values(ExtraType));
const WICKET_TYPES = new Set<string>(Object.values(WicketType));
const FIELDER_REQUIRED_WICKETS = new Set<string>([WicketType.CAUGHT, WicketType.RUN_OUT, WicketType.STUMPED]);

function isExtraType(value: string): value is ExtraType {
  return EXTRA_TYPES.has(value);
}

function isWicketType(value: string): value is WicketType {
  return WICKET_TYPES.has(value);
}

const deliverySelect = {
  sequence: true,
  overNumber: true,
  ballNumber: true,
  strikerId: true,
  nonStrikerId: true,
  bowlerId: true,
  runsBat: true,
  extraType: true,
  extraRuns: true,
  isWicket: true,
  wicketType: true,
  dismissedPlayerId: true,
  fielderId: true,
} as const;

const inningsSelect = {
  id: true,
  fixtureId: true,
  inningsNumber: true,
  battingTeamId: true,
  bowlingTeamId: true,
  oversLimit: true,
  status: true,
  target: true,
  currentStrikerId: true,
  currentNonStrikerId: true,
  currentBowlerId: true,
  isDeleted: true,
} as const;

async function loadStartingLineupIds(fixtureId: string, teamId: string): Promise<Set<string>> {
  const lineup = await prisma.cricketFixtureLineUp.findMany({
    where: { fixtureId, teamId, isDeleted: false, participationType: LineupParticipationType.STARTING },
    select: { tournamentPlayerId: true },
  });
  return new Set(lineup.map((l) => l.tournamentPlayerId));
}

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

function serializeState(state: InningsState) {
  return {
    totalRuns: state.totalRuns,
    totalWickets: state.totalWickets,
    legalBalls: state.legalBalls,
    overNumber: state.overNumber,
    ballNumber: state.ballNumber,
    thisOverBalls: state.thisOverBalls,
    currentStrikerId: state.currentStrikerId,
    currentNonStrikerId: state.currentNonStrikerId,
    currentBowlerId: state.currentBowlerId,
    previousOverBowlerId: state.previousOverBowlerId,
    awaitingNewBatsman: state.awaitingNewBatsman,
    awaitingNewBowler: state.awaitingNewBowler,
    isOver: state.isOver,
  };
}

async function loadInningsForFixture(fixtureId: string, inningsId: string) {
  const innings = await prisma.cricketInnings.findUnique({ where: { id: inningsId }, select: inningsSelect });
  if (!innings || innings.isDeleted || innings.fixtureId !== fixtureId) return null;
  return innings;
}

// POST /tournaments/:id/fixtures/:fixtureId/innings/:inningsId/balls
export async function recordBall(req: Request, res: Response): Promise<void> {
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

  const runsBatRaw: number = req.body?.runsBat ?? 0;
  const extraTypeRaw: string = req.body?.extraType ?? ExtraType.NONE;
  const extraRunsRaw: number = req.body?.extraRuns ?? 0;
  const isWicket: boolean = req.body?.isWicket ?? false;
  const wicketTypeRaw: string | undefined = req.body?.wicketType;
  const dismissedPlayerId: string | undefined = req.body?.dismissedPlayerId;
  const fielderId: string | undefined = req.body?.fielderId;
  const nextBatsmanId: string | undefined = req.body?.nextBatsmanId;
  const nextBowlerId: string | undefined = req.body?.nextBowlerId;

  if (!Number.isInteger(runsBatRaw) || runsBatRaw < 0 || runsBatRaw > 6) {
    res.status(400).json({ error: "runsBat must be an integer between 0 and 6" });
    return;
  }
  if (!isExtraType(extraTypeRaw)) {
    res.status(400).json({ error: "Invalid extraType" });
    return;
  }
  const extraType = extraTypeRaw;
  if (!Number.isInteger(extraRunsRaw) || extraRunsRaw < 0) {
    res.status(400).json({ error: "extraRuns must be a non-negative integer" });
    return;
  }
  if (extraType === ExtraType.NONE && extraRunsRaw !== 0) {
    res.status(400).json({ error: "extraRuns must be 0 when extraType is NONE" });
    return;
  }
  if (extraType !== ExtraType.NONE && extraRunsRaw < 1) {
    res.status(400).json({ error: "extraRuns must be at least 1 for a wide/no-ball/bye/leg-bye/penalty" });
    return;
  }
  if ((extraType === ExtraType.WIDE || extraType === ExtraType.BYE || extraType === ExtraType.LEG_BYE || extraType === ExtraType.PENALTY) && runsBatRaw !== 0) {
    res.status(400).json({ error: "runsBat must be 0 on a wide, bye, leg-bye, or penalty delivery" });
    return;
  }

  let wicketType: WicketType | null = null;
  if (isWicket) {
    if (!wicketTypeRaw || !isWicketType(wicketTypeRaw)) {
      res.status(400).json({ error: "wicketType is required and must be valid when isWicket is true" });
      return;
    }
    wicketType = wicketTypeRaw;
    if (!dismissedPlayerId || !isUuid(dismissedPlayerId)) {
      res.status(400).json({ error: "dismissedPlayerId is required and must be a valid UUID when isWicket is true" });
      return;
    }
    const fielderRequired = FIELDER_REQUIRED_WICKETS.has(wicketType);
    if (fielderRequired && (!fielderId || !isUuid(fielderId))) {
      res.status(400).json({ error: `fielderId is required for wicketType ${wicketType}` });
      return;
    }
    if (!fielderRequired && fielderId !== undefined) {
      res.status(400).json({ error: `fielderId is not applicable for wicketType ${wicketType}` });
      return;
    }
  }
  if (nextBatsmanId !== undefined && !isUuid(nextBatsmanId)) {
    res.status(400).json({ error: "nextBatsmanId must be a valid UUID" });
    return;
  }
  if (nextBowlerId !== undefined && !isUuid(nextBowlerId)) {
    res.status(400).json({ error: "nextBowlerId must be a valid UUID" });
    return;
  }

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { id: true, tournamentId: true, stageId: true, homeTeamId: true, awayTeamId: true, isDeleted: true, status: true },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }
    if (fixture.status !== FixtureStatus.IN_PROGRESS) {
      res.status(400).json({ error: "Fixture is not in progress" });
      return;
    }

    const innings = await loadInningsForFixture(fixtureId, inningsId);
    if (!innings) {
      res.status(404).json({ error: "Innings not found" });
      return;
    }
    if (innings.status !== InningsStatus.IN_PROGRESS) {
      res.status(400).json({ error: "Innings is not in progress" });
      return;
    }

    const existingDeliveries = await prisma.cricketDelivery.findMany({
      where: { inningsId },
      orderBy: { sequence: "asc" },
      select: deliverySelect,
    });

    const seed = {
      strikerId: innings.currentStrikerId,
      nonStrikerId: innings.currentNonStrikerId,
      bowlerId: innings.currentBowlerId,
    };

    const stateBefore = replayInnings(existingDeliveries, innings.oversLimit, innings.target, seed);
    if (stateBefore.isOver.ended) {
      res.status(400).json({ error: "This innings has already ended" });
      return;
    }
    if (!stateBefore.currentStrikerId || !stateBefore.currentNonStrikerId || !stateBefore.currentBowlerId) {
      res.status(400).json({ error: "Innings is waiting on a new batsman or bowler selection" });
      return;
    }
    if (isWicket && dismissedPlayerId !== stateBefore.currentStrikerId && dismissedPlayerId !== stateBefore.currentNonStrikerId) {
      res.status(400).json({ error: "dismissedPlayerId must be the current striker or non-striker" });
      return;
    }

    const legal = extraType !== ExtraType.WIDE && extraType !== ExtraType.NO_BALL;
    const sequence = stateBefore.nextSequence;
    const overNumber = stateBefore.overNumber;
    const ballNumber = legal ? stateBefore.ballNumber + 1 : stateBefore.ballNumber;

    const newDelivery: DeliveryForReplay = {
      sequence,
      strikerId: stateBefore.currentStrikerId,
      nonStrikerId: stateBefore.currentNonStrikerId,
      bowlerId: stateBefore.currentBowlerId,
      runsBat: runsBatRaw,
      extraType,
      extraRuns: extraRunsRaw,
      isWicket,
      dismissedPlayerId: isWicket ? dismissedPlayerId! : null,
    };

    // Deliberately an empty seed, not `seed` — this ball's own transition (if
    // any) hasn't been resolved yet, so a wicket/over-end here must surface as
    // a genuine null/awaiting slot rather than falling back to the pre-ball
    // cache (which would just show the batsman/bowler this ball replaced).
    const stateAfter = replayInnings(
      [...existingDeliveries, newDelivery],
      innings.oversLimit,
      innings.target,
      { strikerId: null, nonStrikerId: null, bowlerId: null },
    );

    let resolvedStrikerId = stateAfter.currentStrikerId;
    let resolvedNonStrikerId = stateAfter.currentNonStrikerId;
    let resolvedBowlerId = stateAfter.currentBowlerId;

    // A wicket/over-end pick (nextBatsmanId/nextBowlerId) is optional here — the
    // ball itself is always recorded regardless, leaving the resolved slot null
    // (awaitingNewBatsman/awaitingNewBowler) when no pick was supplied. The score
    // must never be blocked on picking the next player; that pick is instead made
    // via the separate selectNextPlayer endpoint once the ball is already saved.
    if (!stateAfter.isOver.ended) {
      if (stateAfter.awaitingNewBatsman && nextBatsmanId) {
        const battingStarters = await loadStartingLineupIds(fixtureId, innings.battingTeamId);
        if (!battingStarters.has(nextBatsmanId)) {
          res.status(400).json({ error: "nextBatsmanId must be one of the batting team's starting XI" });
          return;
        }
        const survivor = stateAfter.currentStrikerId ?? stateAfter.currentNonStrikerId;
        if (nextBatsmanId === survivor) {
          res.status(400).json({ error: "nextBatsmanId cannot be the not-out batsman already at the crease" });
          return;
        }
        const alreadyDismissed = new Set(
          [...existingDeliveries, newDelivery].filter((d) => d.isWicket).map((d) => d.dismissedPlayerId),
        );
        if (alreadyDismissed.has(nextBatsmanId)) {
          res.status(400).json({ error: "nextBatsmanId has already been dismissed this innings" });
          return;
        }
        if (stateAfter.currentStrikerId === null) resolvedStrikerId = nextBatsmanId;
        else resolvedNonStrikerId = nextBatsmanId;
      }
      if (stateAfter.awaitingNewBowler && nextBowlerId) {
        if (nextBowlerId === stateAfter.previousOverBowlerId) {
          res.status(400).json({ error: "nextBowlerId cannot be the same bowler who bowled the previous over" });
          return;
        }
        const bowlingStarters = await loadStartingLineupIds(fixtureId, innings.bowlingTeamId);
        if (!bowlingStarters.has(nextBowlerId)) {
          res.status(400).json({ error: "nextBowlerId must be one of the bowling team's starting XI" });
          return;
        }
        resolvedBowlerId = nextBowlerId;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cricketDelivery.create({
        data: {
          inningsId,
          sequence,
          overNumber,
          ballNumber,
          strikerId: newDelivery.strikerId,
          nonStrikerId: newDelivery.nonStrikerId,
          bowlerId: newDelivery.bowlerId,
          runsBat: runsBatRaw,
          extraType,
          extraRuns: extraRunsRaw,
          isWicket,
          wicketType,
          dismissedPlayerId: newDelivery.dismissedPlayerId,
          fielderId: isWicket && fielderId ? fielderId : null,
        },
      });

      if (stateAfter.isOver.ended) {
        await tx.cricketInnings.update({
          where: { id: inningsId },
          data: { status: InningsStatus.COMPLETED, currentStrikerId: null, currentNonStrikerId: null, currentBowlerId: null },
        });

        if (innings.inningsNumber === 1) {
          await tx.cricketInnings.upsert({
            where: { fixtureId_inningsNumber: { fixtureId, inningsNumber: 2 } },
            create: {
              fixtureId,
              inningsNumber: 2,
              battingTeamId: innings.bowlingTeamId,
              bowlingTeamId: innings.battingTeamId,
              oversLimit: innings.oversLimit,
              status: InningsStatus.NOT_STARTED,
              target: stateAfter.totalRuns + 1,
            },
            update: {
              battingTeamId: innings.bowlingTeamId,
              bowlingTeamId: innings.battingTeamId,
              oversLimit: innings.oversLimit,
              target: stateAfter.totalRuns + 1,
            },
          });
        } else {
          const inningsOne = await tx.cricketInnings.findUniqueOrThrow({
            where: { fixtureId_inningsNumber: { fixtureId, inningsNumber: 1 } },
            select: { battingTeamId: true, oversLimit: true, target: true, id: true },
          });
          const inningsOneDeliveries = await tx.cricketDelivery.findMany({
            where: { inningsId: inningsOne.id },
            orderBy: { sequence: "asc" },
            select: deliverySelect,
          });
          const inningsOneState = replayInnings(inningsOneDeliveries, inningsOne.oversLimit, inningsOne.target, {
            strikerId: null, nonStrikerId: null, bowlerId: null,
          });

          const inn1Runs = inningsOneState.totalRuns;
          const inn1Wickets = inningsOneState.totalWickets;
          const inn1Balls = inningsOneState.legalBalls;
          const inn2Runs = stateAfter.totalRuns;
          const inn2Wickets = stateAfter.totalWickets;
          const inn2Balls = stateAfter.legalBalls;

          const homeRuns = inningsOne.battingTeamId === fixture.homeTeamId ? inn1Runs : inn2Runs;
          const homeWickets = inningsOne.battingTeamId === fixture.homeTeamId ? inn1Wickets : inn2Wickets;
          const homeBalls = inningsOne.battingTeamId === fixture.homeTeamId ? inn1Balls : inn2Balls;
          const awayRuns = inningsOne.battingTeamId === fixture.homeTeamId ? inn2Runs : inn1Runs;
          const awayWickets = inningsOne.battingTeamId === fixture.homeTeamId ? inn2Wickets : inn1Wickets;
          const awayBalls = inningsOne.battingTeamId === fixture.homeTeamId ? inn2Balls : inn1Balls;

          let winnerId: string | null = null;
          if (homeRuns > awayRuns) winnerId = fixture.homeTeamId;
          else if (awayRuns > homeRuns) winnerId = fixture.awayTeamId;

          await tx.cricketMatchResult.update({
            where: { fixtureId },
            data: { homeRuns, homeWickets, homeBalls, awayRuns, awayWickets, awayBalls },
          });

          await tx.fixture.update({ where: { id: fixtureId }, data: { status: FixtureStatus.COMPLETED, winnerId } });

          const [total, completed] = await Promise.all([
            tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false } }),
            tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false, status: FixtureStatus.COMPLETED } }),
          ]);
          const newStageStatus = total > 0 && completed === total
            ? StageStatus.COMPLETED
            : completed > 0 ? StageStatus.IN_PROGRESS : StageStatus.PENDING;
          await tx.tournamentStage.update({ where: { id: fixture.stageId }, data: { status: newStageStatus } });
        }
      } else {
        await tx.cricketInnings.update({
          where: { id: inningsId },
          data: {
            currentStrikerId: resolvedStrikerId,
            currentNonStrikerId: resolvedNonStrikerId,
            currentBowlerId: resolvedBowlerId,
          },
        });
      }

      return tx.fixture.findUniqueOrThrow({ where: { id: fixtureId }, select: fixtureSelect });
    });

    res.status(200).json({ message: "Ball recorded", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to record ball" });
  }
}

// PATCH /tournaments/:id/fixtures/:fixtureId/innings/:inningsId/next-player
// Resolves a pending new-batsman/new-bowler pick left open by recordBall
// (the ball that caused the wicket/over-end is already saved by that point —
// this only fills in the awaiting slot(s), it never touches deliveries).
export async function selectNextPlayer(req: Request, res: Response): Promise<void> {
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

  const nextBatsmanId: string | undefined = req.body?.nextBatsmanId;
  const nextBowlerId: string | undefined = req.body?.nextBowlerId;

  if (nextBatsmanId !== undefined && !isUuid(nextBatsmanId)) {
    res.status(400).json({ error: "nextBatsmanId must be a valid UUID" });
    return;
  }
  if (nextBowlerId !== undefined && !isUuid(nextBowlerId)) {
    res.status(400).json({ error: "nextBowlerId must be a valid UUID" });
    return;
  }
  if (!nextBatsmanId && !nextBowlerId) {
    res.status(400).json({ error: "At least one of nextBatsmanId or nextBowlerId is required" });
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

    const innings = await loadInningsForFixture(fixtureId, inningsId);
    if (!innings) {
      res.status(404).json({ error: "Innings not found" });
      return;
    }
    if (innings.status !== InningsStatus.IN_PROGRESS) {
      res.status(400).json({ error: "Innings is not in progress" });
      return;
    }

    const deliveries = await prisma.cricketDelivery.findMany({
      where: { inningsId },
      orderBy: { sequence: "asc" },
      select: deliverySelect,
    });
    // Seed from the innings' cached currentXId fields, not an empty seed —
    // unlike recordBall's stateAfter (which deliberately ignores the cache to
    // surface a brand-new ball's own transition), this endpoint never adds a
    // delivery. A wicket-on-the-last-ball leaves BOTH a batsman and bowler pick
    // pending, resolved via two separate calls; an empty seed would forget the
    // first call's resolution when computing the second (the pick lives only
    // in this cache column, never in delivery history), flipping it back to
    // "awaiting" and looping the picker forever.
    const state = replayInnings(deliveries, innings.oversLimit, innings.target, {
      strikerId: innings.currentStrikerId,
      nonStrikerId: innings.currentNonStrikerId,
      bowlerId: innings.currentBowlerId,
    });
    if (state.isOver.ended) {
      res.status(400).json({ error: "This innings has already ended" });
      return;
    }

    let resolvedStrikerId = state.currentStrikerId;
    let resolvedNonStrikerId = state.currentNonStrikerId;
    let resolvedBowlerId = state.currentBowlerId;

    if (nextBatsmanId) {
      if (!state.awaitingNewBatsman) {
        res.status(400).json({ error: "No batsman selection is currently pending" });
        return;
      }
      const battingStarters = await loadStartingLineupIds(fixtureId, innings.battingTeamId);
      if (!battingStarters.has(nextBatsmanId)) {
        res.status(400).json({ error: "nextBatsmanId must be one of the batting team's starting XI" });
        return;
      }
      const survivor = state.currentStrikerId ?? state.currentNonStrikerId;
      if (nextBatsmanId === survivor) {
        res.status(400).json({ error: "nextBatsmanId cannot be the not-out batsman already at the crease" });
        return;
      }
      const alreadyDismissed = new Set(deliveries.filter((d) => d.isWicket).map((d) => d.dismissedPlayerId));
      if (alreadyDismissed.has(nextBatsmanId)) {
        res.status(400).json({ error: "nextBatsmanId has already been dismissed this innings" });
        return;
      }
      if (state.currentStrikerId === null) resolvedStrikerId = nextBatsmanId;
      else resolvedNonStrikerId = nextBatsmanId;
    }

    if (nextBowlerId) {
      if (!state.awaitingNewBowler) {
        res.status(400).json({ error: "No bowler selection is currently pending" });
        return;
      }
      if (nextBowlerId === state.previousOverBowlerId) {
        res.status(400).json({ error: "nextBowlerId cannot be the same bowler who bowled the previous over" });
        return;
      }
      const bowlingStarters = await loadStartingLineupIds(fixtureId, innings.bowlingTeamId);
      if (!bowlingStarters.has(nextBowlerId)) {
        res.status(400).json({ error: "nextBowlerId must be one of the bowling team's starting XI" });
        return;
      }
      resolvedBowlerId = nextBowlerId;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cricketInnings.update({
        where: { id: inningsId },
        data: {
          currentStrikerId: resolvedStrikerId,
          currentNonStrikerId: resolvedNonStrikerId,
          currentBowlerId: resolvedBowlerId,
        },
      });
      return tx.fixture.findUniqueOrThrow({ where: { id: fixtureId }, select: fixtureSelect });
    });

    res.status(200).json({ message: "Next player selected", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to select next player" });
  }
}

// DELETE /tournaments/:id/fixtures/:fixtureId/innings/:inningsId/balls/last
export async function undoLastBall(req: Request, res: Response): Promise<void> {
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

  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { id: true, tournamentId: true, stageId: true, homeTeamId: true, awayTeamId: true, isDeleted: true },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }

    const innings = await loadInningsForFixture(fixtureId, inningsId);
    if (!innings) {
      res.status(404).json({ error: "Innings not found" });
      return;
    }

    const deliveries = await prisma.cricketDelivery.findMany({
      where: { inningsId },
      orderBy: { sequence: "asc" },
      select: deliverySelect,
    });
    const lastDelivery = deliveries[deliveries.length - 1];
    if (!lastDelivery) {
      res.status(404).json({ error: "No deliveries to undo in this innings" });
      return;
    }

    if (innings.inningsNumber === 1 && innings.status === InningsStatus.COMPLETED) {
      const inningsTwo = await prisma.cricketInnings.findUnique({
        where: { fixtureId_inningsNumber: { fixtureId, inningsNumber: 2 } },
        select: { id: true, isDeleted: true },
      });
      if (inningsTwo && !inningsTwo.isDeleted) {
        const inningsTwoBallCount = await prisma.cricketDelivery.count({ where: { inningsId: inningsTwo.id } });
        if (inningsTwoBallCount > 0) {
          res.status(400).json({ error: "Cannot undo — the next innings has already started" });
          return;
        }
      }
    }

    // The deleted delivery's own strikerId/nonStrikerId/bowlerId are ground
    // truth for whoever was resolved to play it — whether that's the opening
    // XI (if it was the innings' very first ball) or a new-batsman/new-bowler
    // pick applied after the previous ball's wicket/over-end. Using it as the
    // seed correctly restores that resolution without re-prompting for it.
    const remaining = deliveries.slice(0, -1);
    const seed = { strikerId: lastDelivery.strikerId, nonStrikerId: lastDelivery.nonStrikerId, bowlerId: lastDelivery.bowlerId };

    const state = replayInnings(remaining, innings.oversLimit, innings.target, seed);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cricketDelivery.delete({ where: { inningsId_sequence: { inningsId, sequence: lastDelivery.sequence } } });

      await tx.cricketInnings.update({
        where: { id: inningsId },
        data: {
          status: state.isOver.ended ? InningsStatus.COMPLETED : InningsStatus.IN_PROGRESS,
          currentStrikerId: state.currentStrikerId,
          currentNonStrikerId: state.currentNonStrikerId,
          currentBowlerId: state.currentBowlerId,
        },
      });

      if (innings.inningsNumber === 1 && !state.isOver.ended) {
        await tx.cricketInnings.deleteMany({
          where: { fixtureId, inningsNumber: 2 },
        });
      }

      if (innings.inningsNumber === 2) {
        const wasCompleted = innings.status === InningsStatus.COMPLETED;
        if (wasCompleted) {
          await tx.fixture.update({ where: { id: fixtureId }, data: { status: FixtureStatus.IN_PROGRESS, winnerId: null } });

          const inningsOne = await tx.cricketInnings.findUniqueOrThrow({
            where: { fixtureId_inningsNumber: { fixtureId, inningsNumber: 1 } },
            select: { battingTeamId: true, oversLimit: true, target: true, id: true },
          });
          const inningsOneDeliveries = await tx.cricketDelivery.findMany({
            where: { inningsId: inningsOne.id },
            orderBy: { sequence: "asc" },
            select: deliverySelect,
          });
          const inningsOneState = replayInnings(inningsOneDeliveries, inningsOne.oversLimit, inningsOne.target, {
            strikerId: null, nonStrikerId: null, bowlerId: null,
          });

          const homeRuns = inningsOne.battingTeamId === fixture.homeTeamId ? inningsOneState.totalRuns : state.totalRuns;
          const homeWickets = inningsOne.battingTeamId === fixture.homeTeamId ? inningsOneState.totalWickets : state.totalWickets;
          const homeBalls = inningsOne.battingTeamId === fixture.homeTeamId ? inningsOneState.legalBalls : state.legalBalls;
          const awayRuns = inningsOne.battingTeamId === fixture.homeTeamId ? state.totalRuns : inningsOneState.totalRuns;
          const awayWickets = inningsOne.battingTeamId === fixture.homeTeamId ? state.totalWickets : inningsOneState.totalWickets;
          const awayBalls = inningsOne.battingTeamId === fixture.homeTeamId ? state.legalBalls : inningsOneState.legalBalls;

          await tx.cricketMatchResult.update({
            where: { fixtureId },
            data: { homeRuns, homeWickets, homeBalls, awayRuns, awayWickets, awayBalls },
          });

          const [total, completed] = await Promise.all([
            tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false } }),
            tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false, status: FixtureStatus.COMPLETED } }),
          ]);
          const newStageStatus = total > 0 && completed === total
            ? StageStatus.COMPLETED
            : completed > 0 ? StageStatus.IN_PROGRESS : StageStatus.PENDING;
          await tx.tournamentStage.update({ where: { id: fixture.stageId }, data: { status: newStageStatus } });
        }
      }

      return tx.fixture.findUniqueOrThrow({ where: { id: fixtureId }, select: fixtureSelect });
    });

    res.status(200).json({ message: "Last ball undone", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to undo last ball" });
  }
}

// GET /tournaments/:id/fixtures/:fixtureId/live
export async function getLiveMatch(req: Request, res: Response): Promise<void> {
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

  // Read-only and viewable by any authenticated user — same access model as
  // listStageFixtures — not gated to the organiser/contacts like the
  // scoring-mutation endpoints above, since spectators need to see live scores too.
  try {
    const fixture = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { id: true, tournamentId: true, isDeleted: true },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }

    const inningsList = await prisma.cricketInnings.findMany({
      where: { fixtureId, isDeleted: false },
      orderBy: { inningsNumber: "asc" },
      select: inningsSelect,
    });

    if (inningsList.length === 0) {
      res.status(200).json({ message: "No innings yet", data: { innings: [] } });
      return;
    }

    const results = await Promise.all(
      inningsList.map(async (innings) => {
        const deliveries = await prisma.cricketDelivery.findMany({
          where: { inningsId: innings.id },
          orderBy: { sequence: "asc" },
          select: deliverySelect,
        });
        const seed = {
          strikerId: innings.currentStrikerId,
          nonStrikerId: innings.currentNonStrikerId,
          bowlerId: innings.currentBowlerId,
        };
        const state = replayInnings(deliveries, innings.oversLimit, innings.target, seed);
        return {
          inningsId: innings.id,
          inningsNumber: innings.inningsNumber,
          battingTeamId: innings.battingTeamId,
          bowlingTeamId: innings.bowlingTeamId,
          oversLimit: innings.oversLimit,
          target: innings.target,
          status: innings.status,
          ...serializeState(state),
        };
      }),
    );

    res.status(200).json({ message: "Live match state", data: { innings: results } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch live match state" });
  }
}

// POST /tournaments/:id/fixtures/:fixtureId/reset
// Wipes a match back to its pre-toss state — e.g. a rain-off restarted the next
// day. Deletes all deliveries/innings/match result/lineup for the fixture and
// resets it to SCHEDULED, so the manager starts again from the toss.
export async function resetMatch(req: Request, res: Response): Promise<void> {
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
      select: { id: true, tournamentId: true, stageId: true, isDeleted: true, isBye: true, status: true },
    });
    if (!fixture || fixture.isDeleted || fixture.tournamentId !== tournamentId) {
      res.status(404).json({ error: "Fixture not found" });
      return;
    }
    if (fixture.isBye) {
      res.status(400).json({ error: "Cannot reset a bye fixture" });
      return;
    }
    if (fixture.status !== FixtureStatus.IN_PROGRESS && fixture.status !== FixtureStatus.COMPLETED) {
      res.status(400).json({ error: "Only an in-progress or completed match can be reset" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cricketDelivery.deleteMany({ where: { innings: { fixtureId } } });
      await tx.cricketInnings.deleteMany({ where: { fixtureId } });
      await tx.cricketMatchResult.deleteMany({ where: { fixtureId } });
      await tx.cricketFixtureLineUp.deleteMany({ where: { fixtureId } });

      await tx.fixture.update({
        where: { id: fixtureId },
        data: {
          status: FixtureStatus.SCHEDULED,
          winnerId: null,
          oversPerInnings: null,
          freeHitEnabled: null,
        },
      });

      const [total, completed] = await Promise.all([
        tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false } }),
        tx.fixture.count({ where: { stageId: fixture.stageId, isDeleted: false, status: FixtureStatus.COMPLETED } }),
      ]);
      const newStageStatus = total > 0 && completed === total
        ? StageStatus.COMPLETED
        : completed > 0 ? StageStatus.IN_PROGRESS : StageStatus.PENDING;
      await tx.tournamentStage.update({ where: { id: fixture.stageId }, data: { status: newStageStatus } });

      return tx.fixture.findUniqueOrThrow({ where: { id: fixtureId }, select: fixtureSelect });
    });

    res.status(200).json({ message: "Match reset — start again from the toss", data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to reset match" });
  }
}
