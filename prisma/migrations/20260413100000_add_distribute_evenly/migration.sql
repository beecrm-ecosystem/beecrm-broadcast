-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "distribute_evenly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "campaigns" ADD COLUMN "tier_rate_per_minute" INTEGER;
