-- Revisión de conversaciones reales atendidas por la IA: el mismo revisor del
-- simulador, con lo que consultó el agente. Una fila por pasada y conversación.
-- En ai_settings, el interruptor de la revisión diaria (apagada: gasta tokens)
-- y la última pasada.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "chatReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "chatReviewAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "conversation_reviews" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "agentConfigId" TEXT,
  "agentName" TEXT,
  "verdict" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "findings" JSONB NOT NULL DEFAULT '[]',
  "lastMessageAt" TIMESTAMP(3) NOT NULL,
  "aiMessages" INTEGER NOT NULL DEFAULT 0,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversation_reviews_orgId_createdAt_idx" ON "conversation_reviews"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "conversation_reviews_conversationId_createdAt_idx" ON "conversation_reviews"("conversationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "conversation_reviews" ADD CONSTRAINT "conversation_reviews_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_reviews" ADD CONSTRAINT "conversation_reviews_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
ALTER TABLE "conversation_reviews" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversation_reviews_tenant_isolation" ON "conversation_reviews";
CREATE POLICY "conversation_reviews_tenant_isolation" ON "conversation_reviews"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
