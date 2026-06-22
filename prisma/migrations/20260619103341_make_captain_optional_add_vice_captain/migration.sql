-- DropForeignKey
ALTER TABLE "teams" DROP CONSTRAINT "teams_captainId_fkey";

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "viceCaptainId" UUID,
ALTER COLUMN "captainId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_viceCaptainId_fkey" FOREIGN KEY ("viceCaptainId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
