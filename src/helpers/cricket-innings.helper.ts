import type { ExtraType } from "../../generated/prisma/client.js";

export interface DeliveryForReplay {
  sequence: number;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsBat: number;
  extraType: ExtraType;
  extraRuns: number;
  isWicket: boolean;
  dismissedPlayerId: string | null;
}

export type InningsEndReason = "ALL_OUT" | "OVERS_COMPLETE" | "TARGET_REACHED";

export interface InningsSeed {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
}

export interface InningsState {
  totalRuns: number;
  totalWickets: number;
  legalBalls: number;
  overNumber: number;
  ballNumber: number;
  nextSequence: number;
  thisOverBalls: DeliveryForReplay[];
  currentStrikerId: string | null;
  currentNonStrikerId: string | null;
  currentBowlerId: string | null;
  previousOverBowlerId: string | null;
  awaitingNewBatsman: boolean;
  awaitingNewBowler: boolean;
  isOver: { ended: boolean; reason: InningsEndReason | null };
}

function isLegalDelivery(d: Pick<DeliveryForReplay, "extraType">): boolean {
  return d.extraType !== "WIDE" && d.extraType !== "NO_BALL";
}

/**
 * Single source of truth for innings state. Everything (score, overs, striker/
 * non-striker/bowler, innings-end) is derived by folding over the innings'
 * deliveries in `sequence` order — nothing here is separately-maintained
 * mutable state, so "undo last ball" is just delete-and-replay.
 *
 * Each delivery's own strikerId/nonStrikerId/bowlerId is ground truth for who
 * played that specific ball (the controller resolves new-batsman/new-bowler
 * picks into these fields when inserting), so only the *last* delivery needs
 * inspecting to project who's up next; earlier rows never need revisiting.
 */
export function replayInnings(
  deliveries: DeliveryForReplay[],
  oversLimit: number,
  target: number | null,
  seed: InningsSeed,
): InningsState {
  let totalRuns = 0;
  let totalWickets = 0;
  let legalBalls = 0;
  let thisOverBalls: DeliveryForReplay[] = [];

  for (const d of deliveries) {
    totalRuns += d.runsBat + d.extraRuns;
    if (d.isWicket) totalWickets += 1;

    thisOverBalls.push(d);
    if (isLegalDelivery(d)) {
      legalBalls += 1;
      if (legalBalls % 6 === 0) thisOverBalls = [];
    }
  }

  const overNumber = Math.floor(legalBalls / 6);
  const ballNumber = legalBalls % 6;
  const nextSequence = deliveries.length > 0 ? deliveries[deliveries.length - 1]!.sequence + 1 : 1;

  let previousOverBowlerId: string | null = null;
  let strikerFromHistory: string | null = null;
  let nonStrikerFromHistory: string | null = null;
  let bowlerFromHistory: string | null = null;

  const last = deliveries[deliveries.length - 1];
  if (last) {
    let striker: string | null = last.strikerId;
    let nonStriker: string | null = last.nonStrikerId;
    let bowler: string | null = last.bowlerId;

    // Strike rotates on odd runs completed off the bat, or off a bye/leg-bye.
    // A wide's extraRuns includes the mandatory 1-run penalty (no ball faced,
    // never rotates on its own) plus any runs the batsmen physically run while
    // the ball is retrieved, which do rotate strike like a bye/leg-bye would.
    // No-ball runs completed by the batsman are already folded into runsBat,
    // so no special-case needed.
    const rotationRuns = last.extraType === "WIDE"
      ? Math.max(0, last.extraRuns - 1)
      : last.runsBat + (last.extraType === "BYE" || last.extraType === "LEG_BYE" ? last.extraRuns : 0);
    if (rotationRuns % 2 === 1) [striker, nonStriker] = [nonStriker, striker];

    if (last.isWicket) {
      // dismissedPlayerId is one of last.strikerId/last.nonStrikerId (validated
      // at write time) — comparing against the (possibly just-rotated) slot
      // variables still correctly clears whichever one holds that id.
      if (last.dismissedPlayerId === nonStriker) nonStriker = null;
      else striker = null;
    }

    const overJustCompleted = isLegalDelivery(last) && legalBalls % 6 === 0;
    if (overJustCompleted) {
      [striker, nonStriker] = [nonStriker, striker];
      previousOverBowlerId = last.bowlerId;
      bowler = null;
    }

    strikerFromHistory = striker;
    nonStrikerFromHistory = nonStriker;
    bowlerFromHistory = bowler;
  }

  // Pure delivery history can leave a slot null right after a wicket/over-end
  // whose next-batsman/next-bowler pick hasn't produced a delivery row yet —
  // fall back to the seed (the controller's cached resolution) for those.
  // When there's no history at all, the seed *is* the state (the opening XI).
  const currentStrikerId = strikerFromHistory ?? seed.strikerId;
  const currentNonStrikerId = nonStrikerFromHistory ?? seed.nonStrikerId;
  const currentBowlerId = bowlerFromHistory ?? seed.bowlerId;
  const awaitingNewBatsman = currentStrikerId === null || currentNonStrikerId === null;
  const awaitingNewBowler = currentBowlerId === null;

  let reason: InningsEndReason | null = null;
  if (totalWickets >= 10) reason = "ALL_OUT";
  else if (legalBalls >= oversLimit * 6) reason = "OVERS_COMPLETE";
  else if (target !== null && totalRuns >= target) reason = "TARGET_REACHED";

  return {
    totalRuns,
    totalWickets,
    legalBalls,
    overNumber,
    ballNumber,
    nextSequence,
    thisOverBalls,
    currentStrikerId: reason ? null : currentStrikerId,
    currentNonStrikerId: reason ? null : currentNonStrikerId,
    currentBowlerId: reason ? null : currentBowlerId,
    previousOverBowlerId,
    awaitingNewBatsman: reason ? false : awaitingNewBatsman,
    awaitingNewBowler: reason ? false : awaitingNewBowler,
    isOver: { ended: reason !== null, reason },
  };
}
