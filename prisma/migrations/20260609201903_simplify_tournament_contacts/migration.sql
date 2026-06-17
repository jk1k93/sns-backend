/*
  Warnings:

  - You are about to drop the column `email` on the `tournament_contacts` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `tournament_contacts` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `tournament_contacts` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[tournamentId,userId]` on the table `tournament_contacts` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `tournament_contacts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "tournament_contacts" DROP COLUMN "email",
DROP COLUMN "name",
DROP COLUMN "phoneNumber",
ADD COLUMN     "userId" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tournament_contacts_tournamentId_userId_key" ON "tournament_contacts"("tournamentId", "userId");

-- AddForeignKey
ALTER TABLE "tournament_contacts" ADD CONSTRAINT "tournament_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
