-- Oportunidades: cuándo entraron en su etapa, por qué se perdieron, y su
-- historial. El historial lo escribe un disparador para que ningún camino
-- (panel, IA, flujos, API, barridos) se lo salte; quién actuó lo deja la
-- aplicación en `app.actor` dentro de la misma transacción.

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
-- Las que ya existían: la última modificación es la mejor aproximación.
UPDATE "deals" SET "stageEnteredAt" = "updatedAt";

-- ── Historial ──
CREATE TABLE IF NOT EXISTS "deal_events" (
  "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "orgId"       TEXT NOT NULL,
  "dealId"      TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "fromStageId" TEXT,
  "toStageId"   TEXT,
  "meta"        JSONB,
  "actor"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "deal_events_dealId_createdAt_idx" ON "deal_events"("dealId", "createdAt");
CREATE INDEX IF NOT EXISTS "deal_events_orgId_createdAt_idx" ON "deal_events"("orgId", "createdAt");

-- ── Motivos de pérdida ──
CREATE TABLE IF NOT EXISTS "loss_reasons" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "loss_reasons_orgId_name_key" ON "loss_reasons"("orgId", "name");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_events_orgId_fkey') THEN
    ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_events_dealId_fkey') THEN
    ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loss_reasons_orgId_fkey') THEN
    ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "deal_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deal_events_tenant_isolation" ON "deal_events";
CREATE POLICY "deal_events_tenant_isolation" ON "deal_events"
  USING (current_setting('app.current_org', true) = '*' OR "orgId" = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.current_org', true) = '*' OR "orgId" = current_setting('app.current_org', true));

ALTER TABLE "loss_reasons" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "loss_reasons_tenant_isolation" ON "loss_reasons";
CREATE POLICY "loss_reasons_tenant_isolation" ON "loss_reasons"
  USING (current_setting('app.current_org', true) = '*' OR "orgId" = current_setting('app.current_org', true))
  WITH CHECK (current_setting('app.current_org', true) = '*' OR "orgId" = current_setting('app.current_org', true));

-- ── Entrada en la etapa: se reinicia al cambiar de etapa o al volver de descartada ──
CREATE OR REPLACE FUNCTION deal_stage_entered() RETURNS trigger AS $$
BEGIN
  IF NEW."stageId" IS DISTINCT FROM OLD."stageId"
     OR (OLD."discardedAt" IS NOT NULL AND NEW."discardedAt" IS NULL) THEN
    NEW."stageEnteredAt" := CURRENT_TIMESTAMP;
  END IF;
  -- Fuera de una etapa de perdido, el motivo de pérdida no aplica.
  IF NEW."stageId" IS DISTINCT FROM OLD."stageId" AND NEW."lostReason" IS NOT DISTINCT FROM OLD."lostReason" THEN
    NEW."lostReason" := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "deals_stage_entered" ON "deals";
CREATE TRIGGER "deals_stage_entered" BEFORE UPDATE ON "deals"
  FOR EACH ROW EXECUTE FUNCTION deal_stage_entered();

-- ── Historial ──
CREATE OR REPLACE FUNCTION deal_history() RETURNS trigger AS $$
DECLARE
  who TEXT := NULLIF(current_setting('app.actor', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "toStageId", "actor")
      VALUES (NEW."orgId", NEW."id", 'created', NEW."stageId", who);
    RETURN NEW;
  END IF;
  IF NEW."stageId" IS DISTINCT FROM OLD."stageId" THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "fromStageId", "toStageId", "actor")
      VALUES (NEW."orgId", NEW."id", 'stage', OLD."stageId", NEW."stageId", who);
  END IF;
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "meta", "actor")
      VALUES (NEW."orgId", NEW."id", 'owner', jsonb_build_object('from', OLD."ownerId", 'to', NEW."ownerId"), who);
  END IF;
  IF OLD."discardedAt" IS NULL AND NEW."discardedAt" IS NOT NULL THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "meta", "actor")
      VALUES (NEW."orgId", NEW."id", 'discarded', jsonb_build_object('reason', NEW."discardReason"), who);
  ELSIF OLD."discardedAt" IS NOT NULL AND NEW."discardedAt" IS NULL THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "actor")
      VALUES (NEW."orgId", NEW."id", 'restored', who);
  END IF;
  IF NEW."lostReason" IS NOT NULL AND NEW."lostReason" IS DISTINCT FROM OLD."lostReason" THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "meta", "actor")
      VALUES (NEW."orgId", NEW."id", 'lost_reason', jsonb_build_object('reason', NEW."lostReason"), who);
  END IF;
  IF NEW."value" IS DISTINCT FROM OLD."value" THEN
    INSERT INTO "deal_events" ("orgId", "dealId", "kind", "meta", "actor")
      VALUES (NEW."orgId", NEW."id", 'value', jsonb_build_object('from', OLD."value", 'to', NEW."value", 'currency', NEW."currency"), who);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "deals_history" ON "deals";
CREATE TRIGGER "deals_history" AFTER INSERT OR UPDATE ON "deals"
  FOR EACH ROW EXECUTE FUNCTION deal_history();
