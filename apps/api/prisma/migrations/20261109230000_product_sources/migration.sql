-- Catálogos conectados: una tienda (WooCommerce, Shopify) o una hoja de la que
-- Driony lee los productos cada cierto tiempo, y en cada producto de qué
-- conexión viene y con qué id allí. Idempotente.

CREATE TABLE IF NOT EXISTS "product_sources" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "defaultCurrency" TEXT,
  "credentials" TEXT,
  "syncEvery" INTEGER NOT NULL DEFAULT 60,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "lastError" TEXT,
  "lastSummary" JSONB,
  "lastSyncAt" TIMESTAMP(3),
  "nextSyncAt" TIMESTAMP(3),
  "runStartedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_sources_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_sources_orgId_idx" ON "product_sources"("orgId");
CREATE INDEX IF NOT EXISTS "product_sources_nextSyncAt_idx" ON "product_sources"("nextSyncAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_sources_orgId_fkey') THEN
    ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId.
ALTER TABLE "product_sources" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_sources_tenant_isolation" ON "product_sources";
CREATE POLICY "product_sources_tenant_isolation" ON "product_sources"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalId" TEXT,
  ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "products_sourceId_externalId_key" ON "products"("sourceId", "externalId");
CREATE INDEX IF NOT EXISTS "products_sourceId_idx" ON "products"("sourceId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sourceId_fkey') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "product_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
