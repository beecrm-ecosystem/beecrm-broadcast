/*
  Warnings:

  - A unique constraint covering the columns `[providerMessageId]` on the table `messages` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "providerMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_providerMessageId_key" ON "messages"("providerMessageId");
