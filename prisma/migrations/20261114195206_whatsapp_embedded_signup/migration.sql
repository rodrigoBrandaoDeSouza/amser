-- AlterTable
ALTER TABLE "whatsapp_connections" ADD COLUMN     "coexistence_sync_at" TIMESTAMPTZ(3),
ADD COLUMN     "meta_business_id" TEXT,
ADD COLUMN     "onboarding" TEXT NOT NULL DEFAULT 'manual';
