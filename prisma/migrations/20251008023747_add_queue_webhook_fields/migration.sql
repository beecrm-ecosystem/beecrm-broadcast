/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `messages` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" "MessageStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "webhook_events" ADD COLUMN     "event" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'diogenes',
ALTER COLUMN "eventType" DROP NOT NULL,
ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "messages_externalId_key" ON "messages"("externalId");
