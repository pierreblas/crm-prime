-- Llamadas telefónicas (Twilio) y credenciales de Twilio por empresa.
ALTER TABLE "integration_settings"
  ADD COLUMN IF NOT EXISTS "twilioAccountSid" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioAuthTokenEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioApiKeySid" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioApiKeySecretEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioAppSid" TEXT,
  ADD COLUMN IF NOT EXISTS "twilioRecord" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "calls" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "contactId" TEXT,
  "conversationId" TEXT,
  "agentId" TEXT,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "provider" TEXT NOT NULL DEFAULT 'twilio',
  "providerSid" TEXT,
  "fromNumber" TEXT NOT NULL,
  "toNumber" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationSec" INTEGER,
  "recordingSid" TEXT,
  "recordingUrl" TEXT,
  "transcript" TEXT,
  "outcome" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "calls_providerSid_key" ON "calls"("providerSid");
CREATE INDEX IF NOT EXISTS "calls_orgId_createdAt_idx" ON "calls"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "calls_contactId_idx" ON "calls"("contactId");
CREATE INDEX IF NOT EXISTS "calls_conversationId_idx" ON "calls"("conversationId");
ALTER TABLE "calls" ADD CONSTRAINT "calls_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calls" ADD CONSTRAINT "calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calls" ADD CONSTRAINT "calls_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Aislamiento por empresa, igual que el resto de tablas con orgId.
ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calls_tenant_isolation" ON "calls"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
