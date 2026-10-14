-- Conversiones de anuncios (Conversions API for Business Messaging de Meta):
-- dataset por número de WhatsApp y registro de los eventos enviados.
ALTER TABLE "whatsapp_connections"
  ADD COLUMN IF NOT EXISTS "capiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "capiDatasetId" TEXT;

CREATE TABLE IF NOT EXISTS "conversion_events" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "dealId"       TEXT NOT NULL,
  "contactId"    TEXT NOT NULL,
  "connectionId" TEXT,
  "eventName"    TEXT NOT NULL,
  "status"       TEXT NOT NULL,
  "value"        DECIMAL(12,2),
  "currency"     TEXT,
  "error"        TEXT,
  "sentAt"       TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_events_dealId_eventName_key" ON "conversion_events"("dealId", "eventName");
CREATE INDEX IF NOT EXISTS "conversion_events_orgId_createdAt_idx" ON "conversion_events"("orgId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_events_orgId_fkey') THEN
    ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_events_dealId_fkey') THEN
    ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_events_contactId_fkey') THEN
    ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_events_connectionId_fkey') THEN
    ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "whatsapp_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "conversion_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversion_events_tenant_isolation" ON "conversion_events";
CREATE POLICY "conversion_events_tenant_isolation" ON "conversion_events"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
