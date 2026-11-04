-- Cotizador de implementaciones: enlace opcional de cada diagnóstico con una
-- oportunidad del CRM de la empresa propia de Driony (la elegida en los
-- ajustes del cotizador). Si la oportunidad se borra, el enlace queda en null
-- y el historial de lo cotizado no se pierde.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

ALTER TABLE "implementation_assessments" ADD COLUMN IF NOT EXISTS "dealId" TEXT;

CREATE INDEX IF NOT EXISTS "implementation_assessments_dealId_idx" ON "implementation_assessments"("dealId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implementation_assessments_dealId_fkey') THEN
    ALTER TABLE "implementation_assessments" ADD CONSTRAINT "implementation_assessments_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
