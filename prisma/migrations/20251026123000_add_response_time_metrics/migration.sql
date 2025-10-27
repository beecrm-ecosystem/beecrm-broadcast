-- Add response time aggregation fields
ALTER TABLE "campaigns"
ADD COLUMN "responseTimeTotalSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "campaign_recipients"
ADD COLUMN "firstResponseTimeSeconds" DOUBLE PRECISION;

ALTER TABLE "campaign_responses"
ADD COLUMN "responseTimeSeconds" DOUBLE PRECISION;
