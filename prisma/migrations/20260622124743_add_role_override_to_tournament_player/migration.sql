-- AlterTable
ALTER TABLE "tournament_players" ADD COLUMN     "roleId" UUID;

-- AddForeignKey
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "cricket_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
