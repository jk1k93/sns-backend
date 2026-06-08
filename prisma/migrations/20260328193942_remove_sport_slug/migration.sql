/*
  Warnings:

  - You are about to drop the column `slug` on the `sports` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "sports_slug_key";

-- AlterTable
ALTER TABLE "sports" DROP COLUMN "slug";
