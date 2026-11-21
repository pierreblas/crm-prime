-- «Mejorar agente»: la batería de casos de prueba de cada agente, las
-- mediciones (los casos contra las instrucciones de partida y contra cada
-- propuesta), sus conversaciones simuladas, y las versiones anteriores de las
-- instrucciones para poder volver atrás. Idempotente.

CREATE TABLE IF NOT EXISTS "agent_test_cases" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "agentConfigId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "brief" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'custom',
  "presetId" TEXT,
  "conversationId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_test_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_test_cases_orgId_agentConfigId_idx" ON "agent_test_cases"("orgId", "agentConfigId");

CREATE TABLE IF NOT EXISTS "agent_improvement_runs" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "agentConfigId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "repetitions" INTEGER NOT NULL,
  "turns" INTEGER NOT NULL,
  "rounds" INTEGER NOT NULL,
  "contact" JSONB,
  "cases" JSONB NOT NULL,
  "variants" JSONB NOT NULL DEFAULT '[]',
  "best" INTEGER,
  "done" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL DEFAULT 0,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "appliedVariant" INTEGER,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "agent_improvement_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_improvement_runs_orgId_status_idx" ON "agent_improvement_runs"("orgId", "status");
CREATE INDEX IF NOT EXISTS "agent_improvement_runs_agentConfigId_createdAt_idx" ON "agent_improvement_runs"("agentConfigId", "createdAt");

CREATE TABLE IF NOT EXISTS "agent_improvement_results" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "caseTitle" TEXT NOT NULL,
  "variant" INTEGER NOT NULL,
  "repetition" INTEGER NOT NULL,
  "verdict" TEXT,
  "goal" BOOLEAN,
  "summary" TEXT NOT NULL DEFAULT '',
  "findings" JSONB NOT NULL DEFAULT '[]',
  "lines" JSONB NOT NULL DEFAULT '[]',
  "ended" TEXT,
  "error" TEXT,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_improvement_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_improvement_results_runId_variant_idx" ON "agent_improvement_results"("runId", "variant");

CREATE TABLE IF NOT EXISTS "agent_prompt_versions" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "agentConfigId" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_prompt_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "agent_prompt_versions_agentConfigId_createdAt_idx" ON "agent_prompt_versions"("agentConfigId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_cases_orgId_fkey') THEN
    ALTER TABLE "agent_test_cases" ADD CONSTRAINT "agent_test_cases_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_test_cases_agentConfigId_fkey') THEN
    ALTER TABLE "agent_test_cases" ADD CONSTRAINT "agent_test_cases_agentConfigId_fkey"
      FOREIGN KEY ("agentConfigId") REFERENCES "agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_improvement_runs_orgId_fkey') THEN
    ALTER TABLE "agent_improvement_runs" ADD CONSTRAINT "agent_improvement_runs_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_improvement_runs_agentConfigId_fkey') THEN
    ALTER TABLE "agent_improvement_runs" ADD CONSTRAINT "agent_improvement_runs_agentConfigId_fkey"
      FOREIGN KEY ("agentConfigId") REFERENCES "agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_improvement_results_orgId_fkey') THEN
    ALTER TABLE "agent_improvement_results" ADD CONSTRAINT "agent_improvement_results_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_improvement_results_runId_fkey') THEN
    ALTER TABLE "agent_improvement_results" ADD CONSTRAINT "agent_improvement_results_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "agent_improvement_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_prompt_versions_orgId_fkey') THEN
    ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_prompt_versions_agentConfigId_fkey') THEN
    ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_agentConfigId_fkey"
      FOREIGN KEY ("agentConfigId") REFERENCES "agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_test_cases', 'agent_improvement_runs', 'agent_improvement_results', 'agent_prompt_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (current_setting(''app.current_org'', true) = ''*'' OR "orgId" = current_setting(''app.current_org'', true)) WITH CHECK (current_setting(''app.current_org'', true) = ''*'' OR "orgId" = current_setting(''app.current_org'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
