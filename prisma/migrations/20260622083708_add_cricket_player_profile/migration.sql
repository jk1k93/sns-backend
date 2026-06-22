/*
  Warnings:

  - You are about to drop the column `jerseyNumber` on the `tournament_players` table. All the data in the column will be lost.
  - You are about to drop the column `jerseySize` on the `tournament_players` table. All the data in the column will be lost.
  - You are about to drop the column `roleId` on the `tournament_players` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "Hand" AS ENUM ('LEFT', 'RIGHT');

-- DropForeignKey
ALTER TABLE "tournament_players" DROP CONSTRAINT "tournament_players_roleId_fkey";

-- AlterTable
ALTER TABLE "tournament_players" DROP COLUMN "jerseyNumber",
DROP COLUMN "jerseySize",
DROP COLUMN "roleId";

-- CreateTable
CREATE TABLE "cricket_player_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID,
    "battingHand" "Hand",
    "bowlingHand" "Hand",
    "jerseyNumber" INTEGER,
    "jerseySize" "JerseySize",
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cricket_player_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cricket_player_profiles_userId_key" ON "cricket_player_profiles"("userId");

-- AddForeignKey
ALTER TABLE "cricket_player_profiles" ADD CONSTRAINT "cricket_player_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cricket_player_profiles" ADD CONSTRAINT "cricket_player_profiles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "cricket_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
