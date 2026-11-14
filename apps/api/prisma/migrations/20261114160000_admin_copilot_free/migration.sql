-- Copiloto del administrador gratis hasta un número de preguntas al mes por
-- empresa: cada pregunta queda aquí (para el contador) y sus llamadas al modelo
-- van a ai_usage con source = 'courtesy', que no cuenta para el cupo. Idempotente.

CREATE TABLE IF NOT EXISTS "admin_copilot_questions" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT,
  "free" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_copilot_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_copilot_questions_orgId_createdAt_idx" ON "admin_copilot_questions"("orgId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_copilot_questions_orgId_fkey') THEN
    ALTER TABLE "admin_copilot_questions" ADD CONSTRAINT "admin_copilot_questions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_copilot_questions_userId_fkey') THEN
    ALTER TABLE "admin_copilot_questions" ADD CONSTRAINT "admin_copilot_questions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
ALTER TABLE "admin_copilot_questions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_copilot_questions_tenant_isolation" ON "admin_copilot_questions";
CREATE POLICY "admin_copilot_questions_tenant_isolation" ON "admin_copilot_questions"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
