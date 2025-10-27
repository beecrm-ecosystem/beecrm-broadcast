-- AlterTable
ALTER TABLE "campaigns"
ADD COLUMN     "responsesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "respondedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastResponseAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "campaign_recipients"
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "lastResponseAt" TIMESTAMP(3),
ADD COLUMN     "responseCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "campaign_responses" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT,
    "messageId" TEXT,
    "whatsappMessageId" TEXT,
    "fromPhone" TEXT NOT NULL,
    "responseType" TEXT,
    "textBody" TEXT,
    "mediaUrl" TEXT,
    "metadata" JSONB,
    "responsePayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_responses_whatsappMessageId_key" ON "campaign_responses"("whatsappMessageId");
CREATE INDEX "campaign_responses_campaignId_idx" ON "campaign_responses"("campaignId");
CREATE INDEX "campaign_responses_recipientId_idx" ON "campaign_responses"("recipientId");
CREATE INDEX "campaign_responses_messageId_idx" ON "campaign_responses"("messageId");

-- AddForeignKey
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
