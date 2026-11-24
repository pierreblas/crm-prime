-- «Corregir al agente»: cambios en sus instrucciones a partir de chats reales
-- revisados, y cada chat con lo que respondió, lo que respondería hoy y lo que
-- respondería con el cambio. Idempotente.

CREATE TABLE IF NOT EXISTS "agent_corrections" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "agentConfigId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "note" TEXT NOT NULL DEFAULT '',
  "basePrompt" TEXT NOT NULL,
  "prompt" TEXT NOT NULL DEFAULT '',
  "changes" JSONB NOT NULL DEFAULT '[]',
  "runId" TEXT,
  "done" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL DEFAULT 0,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "agent_corrections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_corrections_orgId_status_idx" ON "agent_corrections"("orgId", "status");
CREATE INDEX IF NOT EXISTS "agent_corrections_agentConfigId_createdAt_idx" ON "agent_corrections"("agentConfigId", "createdAt");

CREATE TABLE IF NOT EXISTS "agent_correction_chats" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "correctionId" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "customer" TEXT NOT NULL DEFAULT '',
  "before" TEXT NOT NULL DEFAULT '',
  "today" TEXT,
  "after" TEXT,
  "outcome" TEXT NOT NULL DEFAULT 'pending',
  "note" TEXT NOT NULL DEFAULT '',
  "caseTitle" TEXT,
  "caseBrief" TEXT,
  "missing" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_correction_chats_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_correction_chats_correctionId_position_idx" ON "agent_correction_chats"("correctionId", "position");
CREATE INDEX IF NOT EXISTS "agent_correction_chats_reviewId_idx" ON "agent_correction_chats"("reviewId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_corrections_orgId_fkey') THEN
    ALTER TABLE "agent_corrections" ADD CONSTRAINT "agent_corrections_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_corrections_agentConfigId_fkey') THEN
    ALTER TABLE "agent_corrections" ADD CONSTRAINT "agent_corrections_agentConfigId_fkey"
      FOREIGN KEY ("agentConfigId") REFERENCES "agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_correction_chats_orgId_fkey') THEN
    ALTER TABLE "agent_correction_chats" ADD CONSTRAINT "agent_correction_chats_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_correction_chats_correctionId_fkey') THEN
    ALTER TABLE "agent_correction_chats" ADD CONSTRAINT "agent_correction_chats_correctionId_fkey"
      FOREIGN KEY ("correctionId") REFERENCES "agent_corrections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_correction_chats_reviewId_fkey') THEN
    ALTER TABLE "agent_correction_chats" ADD CONSTRAINT "agent_correction_chats_reviewId_fkey"
      FOREIGN KEY ("reviewId") REFERENCES "conversation_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_correction_chats_conversationId_fkey') THEN
    ALTER TABLE "agent_correction_chats" ADD CONSTRAINT "agent_correction_chats_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_corrections', 'agent_correction_chats'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (current_setting(''app.current_org'', true) = ''*'' OR "orgId" = current_setting(''app.current_org'', true)) WITH CHECK (current_setting(''app.current_org'', true) = ''*'' OR "orgId" = current_setting(''app.current_org'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
