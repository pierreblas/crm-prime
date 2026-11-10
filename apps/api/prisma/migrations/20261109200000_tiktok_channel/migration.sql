-- TikTok como canal de la bandeja: la cuenta de empresa conectada (con sus
-- tokens), la conversación que cuelga de ella (y su id en TikTok) y el id del
-- cliente en el contacto. Idempotente.

CREATE TABLE IF NOT EXISTS "tiktok_accounts" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "statusReason" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "botId" TEXT,
  "pipelineId" TEXT,
  "sourceId" TEXT,
  "lastWebhookAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tiktok_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_accounts_businessId_key" ON "tiktok_accounts"("businessId");
CREATE INDEX IF NOT EXISTS "tiktok_accounts_orgId_idx" ON "tiktok_accounts"("orgId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tiktok_accounts_orgId_fkey') THEN
    ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tiktok_accounts_botId_fkey') THEN
    ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_botId_fkey" FOREIGN KEY ("botId") REFERENCES "agent_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tiktok_accounts_pipelineId_fkey') THEN
    ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tiktok_accounts_sourceId_fkey') THEN
    ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
ALTER TABLE "tiktok_accounts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tiktok_accounts_tenant_isolation" ON "tiktok_accounts";
CREATE POLICY "tiktok_accounts_tenant_isolation" ON "tiktok_accounts"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "tiktokAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE INDEX IF NOT EXISTS "conversations_tiktokAccountId_idx" ON "conversations"("tiktokAccountId");
CREATE INDEX IF NOT EXISTS "conversations_externalId_idx" ON "conversations"("externalId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_tiktokAccountId_fkey') THEN
    ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tiktokAccountId_fkey" FOREIGN KEY ("tiktokAccountId") REFERENCES "tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ttUserId" TEXT;
CREATE INDEX IF NOT EXISTS "contacts_orgId_ttUserId_idx" ON "contacts"("orgId", "ttUserId");
