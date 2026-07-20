-- CreateEnum
CREATE TYPE "LineupParticipationType" AS ENUM ('STARTING', 'SUBSTITUTE');

-- CreateTable
CREATE TABLE "cricket_fixture_lineups" (
    "id" UUID NOT NULL,
    "fixtureId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "tournamentPlayerId" UUID NOT NULL,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "participationType" "LineupParticipationType" NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cricket_fixture_lineups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cricket_fixture_lineups_fixtureId_tournamentPlayerId_key" ON "cricket_fixture_lineups"("fixtureId", "tournamentPlayerId");

-- AddForeignKey
ALTER TABLE "cricket_fixture_lineups" ADD CONSTRAINT "cricket_fixture_lineups_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "fixtures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_fixture_lineups" ADD CONSTRAINT "cricket_fixture_lineups_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_fixture_lineups" ADD CONSTRAINT "cricket_fixture_lineups_tournamentPlayerId_fkey" FOREIGN KEY ("tournamentPlayerId") REFERENCES "tournament_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
