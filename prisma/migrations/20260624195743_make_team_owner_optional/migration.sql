-- DropForeignKey
ALTER TABLE "teams" DROP CONSTRAINT "teams_ownerId_fkey";

-- AlterTable
ALTER TABLE "teams" ALTER COLUMN "ownerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
