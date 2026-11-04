-- Cotizador de implementaciones, P1: ajustes configurables, horas y costos
-- reales, y el candado de inmutabilidad en la propia base.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

CREATE TABLE IF NOT EXISTS "implementation_actuals" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "hourlyCostCents" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "workedOn" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "implementation_actuals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "implementation_pricing_settings" (
    "id" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "implementation_pricing_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "implementation_actuals_quoteId_workedOn_idx" ON "implementation_actuals"("quoteId", "workedOn");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_actuals_quoteId_fkey') THEN
    ALTER TABLE "implementation_actuals" ADD CONSTRAINT "implementation_actuals_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "implementation_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_actuals_nonneg_check') THEN
    ALTER TABLE "implementation_actuals" ADD CONSTRAINT "implementation_actuals_nonneg_check"
      CHECK ("hours" >= 0 AND "hourlyCostCents" >= 0 AND "costCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_actuals_category_check') THEN
    ALTER TABLE "implementation_actuals" ADD CONSTRAINT "implementation_actuals_category_check"
      CHECK ("category" IN ('DIAGNOSIS','CONFIGURATION','AGENT','AUTOMATION','INTEGRATION','DATA','QA','TRAINING','SUPPORT_SETUP','OTHER'));
  END IF;
END $$;

-- ── Candado de inmutabilidad ─────────────────────────────────
-- El servicio ya impide editar lo que no está en borrador, pero un UPDATE a
-- mano se lo saltaría. Aquí la base tiene la última palabra: fuera de DRAFT
-- solo cambian el estado y sus fechas/motivos; lo aprobado no se retoca; un
-- estado final no se mueve; y las partidas solo se tocan en borrador.

CREATE OR REPLACE FUNCTION implementation_quotes_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
       NEW."assessmentId"           IS DISTINCT FROM OLD."assessmentId"
    OR NEW."version"                IS DISTINCT FROM OLD."version"
    OR NEW."currency"               IS DISTINCT FROM OLD."currency"
    OR NEW."planKey"                IS DISTINCT FROM OLD."planKey"
    OR NEW."planPriceCentsSnapshot" IS DISTINCT FROM OLD."planPriceCentsSnapshot"
    OR NEW."aiBillingMode"          IS DISTINCT FROM OLD."aiBillingMode"
    OR NEW."overheadsCents"         IS DISTINCT FROM OLD."overheadsCents"
    OR NEW."contingencyBp"          IS DISTINCT FROM OLD."contingencyBp"
    OR NEW."targetMarginBp"         IS DISTINCT FROM OLD."targetMarginBp"
    OR NEW."roundingCents"          IS DISTINCT FROM OLD."roundingCents"
    OR NEW."proposedPriceCents"     IS DISTINCT FROM OLD."proposedPriceCents"
    OR NEW."diagnosisFeeCents"      IS DISTINCT FROM OLD."diagnosisFeeCents"
    OR NEW."diagnosisCredited"      IS DISTINCT FROM OLD."diagnosisCredited"
    OR NEW."laborCents"             IS DISTINCT FROM OLD."laborCents"
    OR NEW."externalCents"          IS DISTINCT FROM OLD."externalCents"
    OR NEW."baseCostCents"          IS DISTINCT FROM OLD."baseCostCents"
    OR NEW."contingencyCents"       IS DISTINCT FROM OLD."contingencyCents"
    OR NEW."budgetedCostCents"      IS DISTINCT FROM OLD."budgetedCostCents"
    OR NEW."minimumPriceCents"      IS DISTINCT FROM OLD."minimumPriceCents"
    OR NEW."expectedMarginBp"       IS DISTINCT FROM OLD."expectedMarginBp"
    OR NEW."belowMinimum"           IS DISTINCT FROM OLD."belowMinimum"
    OR NEW."deliverables"           IS DISTINCT FROM OLD."deliverables"
    OR NEW."assumptions"            IS DISTINCT FROM OLD."assumptions"
    OR NEW."exclusions"             IS DISTINCT FROM OLD."exclusions"
    OR NEW."clientRequirements"     IS DISTINCT FROM OLD."clientRequirements"
    OR NEW."timelineNote"           IS DISTINCT FROM OLD."timelineNote"
    OR NEW."paymentTerms"           IS DISTINCT FROM OLD."paymentTerms"
    OR NEW."externalCostsNote"      IS DISTINCT FROM OLD."externalCostsNote"
    OR NEW."taxNote"                IS DISTINCT FROM OLD."taxNote"
    OR NEW."supportNote"            IS DISTINCT FROM OLD."supportNote"
    OR NEW."validUntil"             IS DISTINCT FROM OLD."validUntil"
    OR NEW."createdBy"              IS DISTINCT FROM OLD."createdBy"
  ) THEN
    RAISE EXCEPTION 'implementation_quotes: la versión % ya no está en borrador; crea una versión nueva', OLD."version"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" IN ('ACCEPTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'implementation_quotes: % es un estado final', OLD."status" USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."approvedSnapshot" IS NOT NULL AND NEW."approvedSnapshot" IS DISTINCT FROM OLD."approvedSnapshot" THEN
    RAISE EXCEPTION 'implementation_quotes: lo aprobado no se modifica' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."approvedAt" IS NOT NULL AND (NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy"
      OR NEW."exceptionReason" IS DISTINCT FROM OLD."exceptionReason" OR NEW."exceptionBy" IS DISTINCT FROM OLD."exceptionBy") THEN
    RAISE EXCEPTION 'implementation_quotes: la aprobación no se reescribe' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS implementation_quotes_guard ON "implementation_quotes";
CREATE TRIGGER implementation_quotes_guard
  BEFORE UPDATE ON "implementation_quotes"
  FOR EACH ROW EXECUTE FUNCTION implementation_quotes_guard();

-- Partidas: solo mientras la versión está en borrador. Si la versión ya no
-- existe (borrado en cascada) no hay nada que proteger.
CREATE OR REPLACE FUNCTION implementation_quote_items_guard() RETURNS trigger AS $$
DECLARE
  st TEXT;
  qid TEXT;
BEGIN
  qid := COALESCE(NEW."quoteId", OLD."quoteId");
  SELECT "status" INTO st FROM "implementation_quotes" WHERE "id" = qid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'implementation_quote_items: la versión ya no está en borrador' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS implementation_quote_items_guard ON "implementation_quote_items";
CREATE TRIGGER implementation_quote_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "implementation_quote_items"
  FOR EACH ROW EXECUTE FUNCTION implementation_quote_items_guard();
