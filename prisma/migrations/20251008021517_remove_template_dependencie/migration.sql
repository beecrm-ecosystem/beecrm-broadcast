/*
  Warnings:

  - Added the required column `templateData` to the `campaigns` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."campaigns" DROP CONSTRAINT "campaigns_templateId_fkey";

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "templateData" JSONB NOT NULL;
