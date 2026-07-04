-- Migrate any remaining DRAFT rows to PUBLISHED
UPDATE "tournaments" SET "status" = 'PUBLISHED' WHERE "status" = 'DRAFT';

-- Switch column to the new type (TournamentStatus without DRAFT) and set new default
ALTER TABLE "tournaments" ALTER COLUMN "status" TYPE "TournamentStatus" USING "status"::text::"TournamentStatus";
ALTER TABLE "tournaments" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED';

-- Clean up old type if it exists (may not exist depending on how the enum was modified)
DROP TYPE IF EXISTS "TournamentStatus_old";
