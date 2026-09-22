-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "batchSize" SET DEFAULT 500,
ALTER COLUMN "delayBetweenBatches" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "campaign_recipients_campaignId_status_idx" ON "campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "messages_campaignId_status_idx" ON "messages"("campaignId", "status");
