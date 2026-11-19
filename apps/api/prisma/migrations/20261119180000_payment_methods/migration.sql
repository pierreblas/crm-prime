-- Métodos de pago de la empresa: el agente los envía tal cual (send_payment_methods),
-- filtrados por el país del cliente. Idempotente.

CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "details" TEXT NOT NULL,
  "instructions" TEXT NOT NULL DEFAULT '',
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_methods_orgId_order_idx" ON "payment_methods"("orgId", "order");

DO $$ BEGIN
  ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_methods_tenant_isolation" ON "payment_methods";
CREATE POLICY "payment_methods_tenant_isolation" ON "payment_methods"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
