-- CreateEnum
CREATE TYPE "GroundType" AS ENUM ('BOX', 'OPEN');

-- CreateEnum
CREATE TYPE "BallType" AS ENUM ('TENNIS', 'LEATHER');

-- CreateTable
CREATE TABLE "cricket_configs" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "groundType" "GroundType" NOT NULL,
    "ballType" "BallType" NOT NULL,
    "numberOfTeams" INTEGER NOT NULL,
    "playersPerTeam" INTEGER NOT NULL,
    "auctionBased" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cricket_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cricket_configs_tournamentId_key" ON "cricket_configs"("tournamentId");

-- AddForeignKey
ALTER TABLE "cricket_configs" ADD CONSTRAINT "cricket_configs_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
