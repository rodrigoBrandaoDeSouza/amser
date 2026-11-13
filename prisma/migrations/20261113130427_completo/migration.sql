-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "anonymized_at" TIMESTAMPTZ(3),
ADD COLUMN     "opted_out_at" TIMESTAMPTZ(3),
ADD COLUMN     "whatsapp_user_id" TEXT;

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "category" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "meta_template_id" TEXT,
ADD COLUMN     "rejected_reason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "deletion_scheduled_at" TIMESTAMPTZ(3),
ADD COLUMN     "retention_months" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "support_access_until" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "mfa_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "mfa_secret_encrypted" TEXT,
ADD COLUMN     "permissions_json" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sessions_valid_after" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "whatsapp_connections" ADD COLUMN     "last_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "quality_rating" TEXT,
ADD COLUMN     "verified_name" TEXT,
ADD COLUMN     "waba_id" TEXT;

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_scope_key" ON "feature_flags"("key", "scope");

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
