-- Add engagement tracking: recipients that replied within 24h of sentAt
ALTER TABLE "campaigns"
ADD COLUMN "engagedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "campaign_recipients"
ADD COLUMN "engagedAt" TIMESTAMP(3);

CREATE INDEX "campaign_recipients_campaignId_engagedAt_idx"
ON "campaign_recipients"("campaignId", "engagedAt");

-- Backfill: marca como engajado quem respondeu (firstResponseTimeSeconds <= 86400)
UPDATE "campaign_recipients"
SET "engagedAt" = "respondedAt"
WHERE "respondedAt" IS NOT NULL
  AND "firstResponseTimeSeconds" IS NOT NULL
  AND "firstResponseTimeSeconds" <= 86400;

-- Backfill do contador agregado na campanha
UPDATE "campaigns" c
SET "engagedCount" = sub.count
FROM (
  SELECT "campaignId", COUNT(*)::int AS count
  FROM "campaign_recipients"
  WHERE "engagedAt" IS NOT NULL
  GROUP BY "campaignId"
) sub
WHERE c."id" = sub."campaignId";
