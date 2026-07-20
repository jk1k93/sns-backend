-- CreateEnum
CREATE TYPE "ExtraType" AS ENUM ('NONE', 'WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', 'PENALTY');

-- CreateEnum
CREATE TYPE "WicketType" AS ENUM ('BOWLED', 'CAUGHT', 'RUN_OUT', 'STUMPED', 'LBW', 'HIT_WICKET', 'RETIRED_OUT', 'OTHER');

-- CreateEnum
CREATE TYPE "InningsStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable: add tournament-level overs/free-hit defaults
ALTER TABLE "cricket_tournament_config" ADD COLUMN "oversPerInnings" INTEGER;
ALTER TABLE "cricket_tournament_config" ADD COLUMN "freeHitEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Backfill existing rows before enforcing NOT NULL
UPDATE "cricket_tournament_config" SET "oversPerInnings" = 20 WHERE "oversPerInnings" IS NULL;

ALTER TABLE "cricket_tournament_config" ALTER COLUMN "oversPerInnings" SET NOT NULL;

-- AlterTable: per-fixture overrides, set at toss time
ALTER TABLE "fixtures" ADD COLUMN "oversPerInnings" INTEGER;
ALTER TABLE "fixtures" ADD COLUMN "freeHitEnabled" BOOLEAN;

-- CreateTable
CREATE TABLE "cricket_innings" (
    "id" UUID NOT NULL,
    "fixtureId" UUID NOT NULL,
    "inningsNumber" INTEGER NOT NULL,
    "battingTeamId" UUID NOT NULL,
    "bowlingTeamId" UUID NOT NULL,
    "oversLimit" INTEGER NOT NULL,
    "status" "InningsStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "target" INTEGER,
    "currentStrikerId" UUID,
    "currentNonStrikerId" UUID,
    "currentBowlerId" UUID,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cricket_innings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cricket_deliveries" (
    "id" UUID NOT NULL,
    "inningsId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "overNumber" INTEGER NOT NULL,
    "ballNumber" INTEGER NOT NULL,
    "strikerId" UUID NOT NULL,
    "nonStrikerId" UUID NOT NULL,
    "bowlerId" UUID NOT NULL,
    "runsBat" INTEGER NOT NULL DEFAULT 0,
    "extraType" "ExtraType" NOT NULL DEFAULT 'NONE',
    "extraRuns" INTEGER NOT NULL DEFAULT 0,
    "isWicket" BOOLEAN NOT NULL DEFAULT false,
    "wicketType" "WicketType",
    "dismissedPlayerId" UUID,
    "fielderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cricket_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cricket_innings_fixtureId_inningsNumber_key" ON "cricket_innings"("fixtureId", "inningsNumber");

-- CreateIndex
CREATE UNIQUE INDEX "cricket_deliveries_inningsId_sequence_key" ON "cricket_deliveries"("inningsId", "sequence");

-- AddForeignKey
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "fixtures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_battingTeamId_fkey" FOREIGN KEY ("battingTeamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_bowlingTeamId_fkey" FOREIGN KEY ("bowlingTeamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_deliveries" ADD CONSTRAINT "cricket_deliveries_inningsId_fkey" FOREIGN KEY ("inningsId") REFERENCES "cricket_innings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
