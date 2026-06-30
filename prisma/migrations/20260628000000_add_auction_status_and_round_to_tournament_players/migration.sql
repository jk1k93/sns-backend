-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('SOLD', 'UNSOLD');

-- AlterTable
ALTER TABLE "tournament_players" ADD COLUMN "auctionStatus" "AuctionStatus",
                                 ADD COLUMN "auctionRound" INTEGER;
