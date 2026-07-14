-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('GROUP', 'KNOCKOUT', 'ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FixtureStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TossChoice" AS ENUM ('BAT', 'BOWL');

-- AlterEnum
BEGIN;
CREATE TYPE "TournamentStatus_new" AS ENUM ('PUBLISHED', 'LIVE', 'CANCELLED', 'COMPLETED');
ALTER TABLE "public"."tournaments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tournaments" ALTER COLUMN "status" TYPE "TournamentStatus_new" USING ("status"::text::"TournamentStatus_new");
ALTER TYPE "TournamentStatus" RENAME TO "TournamentStatus_old";
ALTER TYPE "TournamentStatus_new" RENAME TO "TournamentStatus";
DROP TYPE "public"."TournamentStatus_old";
ALTER TABLE "tournaments" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED';
COMMIT;

-- AlterTable
ALTER TABLE "cricket_tournament_config" RENAME CONSTRAINT "cricket_configs_pkey" TO "cricket_tournament_config_pkey";

-- CreateTable
CREATE TABLE "tournament_stages" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "type" "StageType" NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "numberOfGroups" INTEGER,
    "teamsAdvancingPerGroup" INTEGER,
    "hasByes" BOOLEAN,
    "teamsAdvancing" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_teams" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "seed" INTEGER,
    "drawPosition" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixtures" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "groupId" UUID,
    "homeTeamId" UUID,
    "awayTeamId" UUID,
    "winnerId" UUID,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "byeTeamId" UUID,
    "homeTeamSlot" JSONB,
    "awayTeamSlot" JSONB,
    "roundNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "FixtureStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cricket_match_results" (
    "id" UUID NOT NULL,
    "fixtureId" UUID NOT NULL,
    "homeRuns" INTEGER NOT NULL,
    "homeWickets" INTEGER NOT NULL,
    "homeBalls" INTEGER NOT NULL,
    "awayRuns" INTEGER NOT NULL,
    "awayWickets" INTEGER NOT NULL,
    "awayBalls" INTEGER NOT NULL,
    "tossWinnerId" UUID,
    "tossChoice" "TossChoice",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cricket_match_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_teams_groupId_teamId_key" ON "group_teams"("groupId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "cricket_match_results_fixtureId_key" ON "cricket_match_results"("fixtureId");

-- RenameForeignKey
ALTER TABLE "cricket_tournament_config" RENAME CONSTRAINT "cricket_configs_tournamentId_fkey" TO "cricket_tournament_config_tournamentId_fkey";

-- AddForeignKey
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teams" ADD CONSTRAINT "group_teams_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teams" ADD CONSTRAINT "group_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_byeTeamId_fkey" FOREIGN KEY ("byeTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_match_results" ADD CONSTRAINT "cricket_match_results_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "fixtures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "cricket_configs_tournamentId_key" RENAME TO "cricket_tournament_config_tournamentId_key";
