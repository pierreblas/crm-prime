-- Difusiones: audiencia con filtros (etiquetas incluidas/excluidas, etapa,
-- fuente, país, actividad, no repetir) y cuántos respondieron.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "audience" JSONB;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "repliedCount" INTEGER NOT NULL DEFAULT 0;
-- Para las métricas por difusión y el «no repetir».
CREATE INDEX IF NOT EXISTS "messages_campaignId_idx" ON "messages"("campaignId");

-- Aislamiento: las difusiones no llevan "orgId" (son de la empresa dueña de su
-- plantilla) y no tenían política. Sin ella, con el rol restringido de
-- producción, una empresa podía ver las difusiones de otra.
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaigns_tenant_isolation" ON "campaigns";
CREATE POLICY "campaigns_tenant_isolation" ON "campaigns"
  USING (
    current_setting('app.current_org', true) = '*'
    OR EXISTS (
      SELECT 1 FROM "templates" t
       WHERE t.id = "campaigns"."templateId"
         AND t."orgId" = current_setting('app.current_org', true)
    )
  );

ALTER TABLE "campaign_tags" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_tags_tenant_isolation" ON "campaign_tags";
CREATE POLICY "campaign_tags_tenant_isolation" ON "campaign_tags"
  USING (
    current_setting('app.current_org', true) = '*'
    OR EXISTS (
      SELECT 1 FROM "tags" t
       WHERE t.id = "campaign_tags"."tagId"
         AND t."orgId" = current_setting('app.current_org', true)
    )
  );
