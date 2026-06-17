/*
  Warnings:

  - You are about to alter the column `auctionPurse` on the `cricket_configs` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.

*/
-- AlterTable
ALTER TABLE "cricket_configs" ALTER COLUMN "auctionPurse" SET DATA TYPE INTEGER;
