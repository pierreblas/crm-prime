-- Embudos: agente de IA por embudo. Etapas: rol «potencial» y automatizaciones
-- (cuando pase X en esta etapa, ejecuta el flujo Y).

ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "botId" TEXT;
ALTER TABLE "pipeline_stages" ADD COLUMN IF NOT EXISTS "isQualified" BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipelines_botId_fkey') THEN
    ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_botId_fkey"
      FOREIGN KEY ("botId") REFERENCES "agent_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
-- Las etapas que ya se llamaban así pasan a ser la «potencial» del embudo.
UPDATE "pipeline_stages" SET "isQualified" = true
  WHERE lower("name") IN ('calificado', 'calificada', 'calificados', 'potencial', 'potenciales', 'interesado', 'interesados')
    AND "isWon" = false AND "isLost" = false;

-- Automatizaciones de etapa.
CREATE TABLE IF NOT EXISTS "stage_automations" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "stageId"      TEXT NOT NULL,
  "trigger"      TEXT NOT NULL,
  "flowId"       TEXT NOT NULL,
  "delayMinutes" INTEGER,
  "token"        TEXT,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "order"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stage_automations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "stage_automations_token_key" ON "stage_automations"("token");
CREATE INDEX IF NOT EXISTS "stage_automations_orgId_idx" ON "stage_automations"("orgId");
CREATE INDEX IF NOT EXISTS "stage_automations_stageId_idx" ON "stage_automations"("stageId");
CREATE INDEX IF NOT EXISTS "stage_automations_flowId_idx" ON "stage_automations"("flowId");

-- Una vez por estancia en la etapa («sin respuesta»): candado por oportunidad.
CREATE TABLE IF NOT EXISTS "stage_automation_runs" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "dealId"       TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stage_automation_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "stage_automation_runs_automationId_dealId_key" ON "stage_automation_runs"("automationId", "dealId");
CREATE INDEX IF NOT EXISTS "stage_automation_runs_orgId_idx" ON "stage_automation_runs"("orgId");
CREATE INDEX IF NOT EXISTS "stage_automation_runs_dealId_idx" ON "stage_automation_runs"("dealId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_automations_orgId_fkey') THEN
    ALTER TABLE "stage_automations" ADD CONSTRAINT "stage_automations_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_automations_stageId_fkey') THEN
    ALTER TABLE "stage_automations" ADD CONSTRAINT "stage_automations_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_automations_flowId_fkey') THEN
    ALTER TABLE "stage_automations" ADD CONSTRAINT "stage_automations_flowId_fkey"
      FOREIGN KEY ("flowId") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_automation_runs_orgId_fkey') THEN
    ALTER TABLE "stage_automation_runs" ADD CONSTRAINT "stage_automation_runs_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_automation_runs_automationId_fkey') THEN
    ALTER TABLE "stage_automation_runs" ADD CONSTRAINT "stage_automation_runs_automationId_fkey"
      FOREIGN KEY ("automationId") REFERENCES "stage_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_automation_runs_dealId_fkey') THEN
    ALTER TABLE "stage_automation_runs" ADD CONSTRAINT "stage_automation_runs_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, igual que el resto de tablas con orgId.
ALTER TABLE "stage_automations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_automations_tenant_isolation" ON "stage_automations";
CREATE POLICY "stage_automations_tenant_isolation" ON "stage_automations"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
ALTER TABLE "stage_automation_runs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_automation_runs_tenant_isolation" ON "stage_automation_runs";
CREATE POLICY "stage_automation_runs_tenant_isolation" ON "stage_automation_runs"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
