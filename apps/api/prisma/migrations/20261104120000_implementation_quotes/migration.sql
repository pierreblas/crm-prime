-- Cotizador interno de implementaciones (consola de plataforma).
--
-- Tablas del operador de Driony, no de una empresa: sin orgId como dueño y sin
-- RLS, igual que platform_audit_log. "orgId" es solo un enlace opcional a la
-- empresa cliente, y se queda en NULL si esa empresa se borra (SetNull): lo
-- cotizado no se pierde con la cuenta. No toca ninguna tabla existente.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

CREATE TABLE IF NOT EXISTS "implementation_assessments" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientContact" TEXT NOT NULL DEFAULT '',
    "orgId" TEXT,
    "sector" TEXT NOT NULL DEFAULT '',
    "objective" TEXT NOT NULL DEFAULT '',
    "ownerEmail" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "riskFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "complexityScore" INTEGER NOT NULL DEFAULT 0,
    "complexityBand" TEXT NOT NULL DEFAULT 'low',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "implementation_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "implementation_quotes" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "planKey" TEXT,
    "planPriceCentsSnapshot" INTEGER,
    "aiBillingMode" TEXT NOT NULL DEFAULT 'UNDECIDED',
    "overheadsCents" INTEGER NOT NULL DEFAULT 0,
    "contingencyBp" INTEGER NOT NULL DEFAULT 2000,
    "targetMarginBp" INTEGER NOT NULL DEFAULT 4000,
    "roundingCents" INTEGER NOT NULL DEFAULT 1000,
    "proposedPriceCents" INTEGER,
    "diagnosisFeeCents" INTEGER,
    "diagnosisCredited" BOOLEAN NOT NULL DEFAULT false,
    "laborCents" INTEGER NOT NULL DEFAULT 0,
    "externalCents" INTEGER NOT NULL DEFAULT 0,
    "baseCostCents" INTEGER NOT NULL DEFAULT 0,
    "contingencyCents" INTEGER NOT NULL DEFAULT 0,
    "budgetedCostCents" INTEGER NOT NULL DEFAULT 0,
    "minimumPriceCents" INTEGER NOT NULL DEFAULT 0,
    "expectedMarginBp" INTEGER,
    "belowMinimum" BOOLEAN NOT NULL DEFAULT false,
    "deliverables" TEXT NOT NULL DEFAULT '',
    "assumptions" TEXT NOT NULL DEFAULT '',
    "exclusions" TEXT NOT NULL DEFAULT '',
    "clientRequirements" TEXT NOT NULL DEFAULT '',
    "timelineNote" TEXT NOT NULL DEFAULT '',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "externalCostsNote" TEXT NOT NULL DEFAULT '',
    "taxNote" TEXT NOT NULL DEFAULT '',
    "supportNote" TEXT NOT NULL DEFAULT '',
    "validUntil" TIMESTAMP(3),
    "exceptionReason" TEXT,
    "exceptionBy" TEXT,
    "approvedSnapshot" JSONB,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentNote" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "implementation_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "implementation_quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "hourlyCostCents" INTEGER NOT NULL DEFAULT 0,
    "thirdPartyCents" INTEGER NOT NULL DEFAULT 0,
    "otherCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "implementation_quote_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "implementation_assessments_quoteNumber_key" ON "implementation_assessments"("quoteNumber");
CREATE INDEX IF NOT EXISTS "implementation_assessments_orgId_idx" ON "implementation_assessments"("orgId");
CREATE INDEX IF NOT EXISTS "implementation_assessments_updatedAt_idx" ON "implementation_assessments"("updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "implementation_quotes_assessmentId_version_key" ON "implementation_quotes"("assessmentId", "version");
CREATE INDEX IF NOT EXISTS "implementation_quotes_status_updatedAt_idx" ON "implementation_quotes"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "implementation_quote_items_quoteId_sortOrder_idx" ON "implementation_quote_items"("quoteId", "sortOrder");

-- Numeración COT-<año>-<correlativo>: una sola secuencia, nunca se reutiliza un número.
CREATE SEQUENCE IF NOT EXISTS "implementation_quote_number_seq" START 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_assessments_orgId_fkey') THEN
    ALTER TABLE "implementation_assessments" ADD CONSTRAINT "implementation_assessments_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quotes_assessmentId_fkey') THEN
    ALTER TABLE "implementation_quotes" ADD CONSTRAINT "implementation_quotes_assessmentId_fkey"
      FOREIGN KEY ("assessmentId") REFERENCES "implementation_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quote_items_quoteId_fkey') THEN
    ALTER TABLE "implementation_quote_items" ADD CONSTRAINT "implementation_quote_items_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "implementation_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Las mismas protecciones que el motor, por si alguien escribe a mano.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quotes_status_check') THEN
    ALTER TABLE "implementation_quotes" ADD CONSTRAINT "implementation_quotes_status_check"
      CHECK ("status" IN ('DRAFT','READY_FOR_REVIEW','APPROVED','SENT','ACCEPTED','REJECTED','EXPIRED','SUPERSEDED','CANCELLED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quotes_ai_check') THEN
    ALTER TABLE "implementation_quotes" ADD CONSTRAINT "implementation_quotes_ai_check"
      CHECK ("aiBillingMode" IN ('BYOK','MANAGED','UNDECIDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quotes_margin_check') THEN
    ALTER TABLE "implementation_quotes" ADD CONSTRAINT "implementation_quotes_margin_check"
      CHECK ("targetMarginBp" >= 0 AND "targetMarginBp" < 10000 AND "contingencyBp" >= 0 AND "roundingCents" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quotes_money_check') THEN
    ALTER TABLE "implementation_quotes" ADD CONSTRAINT "implementation_quotes_money_check"
      CHECK ("overheadsCents" >= 0 AND ("proposedPriceCents" IS NULL OR "proposedPriceCents" >= 0) AND ("diagnosisFeeCents" IS NULL OR "diagnosisFeeCents" >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quotes_version_check') THEN
    ALTER TABLE "implementation_quotes" ADD CONSTRAINT "implementation_quotes_version_check" CHECK ("version" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quote_items_category_check') THEN
    ALTER TABLE "implementation_quote_items" ADD CONSTRAINT "implementation_quote_items_category_check"
      CHECK ("category" IN ('DIAGNOSIS','CONFIGURATION','AGENT','AUTOMATION','INTEGRATION','DATA','QA','TRAINING','SUPPORT_SETUP','OTHER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_quote_items_nonneg_check') THEN
    ALTER TABLE "implementation_quote_items" ADD CONSTRAINT "implementation_quote_items_nonneg_check"
      CHECK ("hours" >= 0 AND "hourlyCostCents" >= 0 AND "thirdPartyCents" >= 0 AND "otherCents" >= 0);
  END IF;
END $$;
