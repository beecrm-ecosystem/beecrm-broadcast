-- Add opt-out fields to campaigns and recipients
ALTER TABLE "campaigns"
ADD COLUMN "optOutCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "campaign_recipients"
ADD COLUMN "optedOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "optedOutAt" TIMESTAMP(3),
ADD COLUMN "optOutReason" TEXT;
