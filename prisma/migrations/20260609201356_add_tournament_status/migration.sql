-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT';
