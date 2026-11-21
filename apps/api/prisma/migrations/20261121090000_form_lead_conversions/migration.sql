-- Conversiones de los leads de formularios de Meta (Conversions API, integración
-- de CRM): cada página guarda el conjunto de datos (píxel) que recibe las
-- etapas del embudo y su token cifrado, y cada evento enviado dice por qué vía
-- salió. Las filas que ya existen son de anuncios de clic a WhatsApp.
-- Idempotente.

ALTER TABLE "meta_pages" ADD COLUMN IF NOT EXISTS "capiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "meta_pages" ADD COLUMN IF NOT EXISTS "capiDatasetId" TEXT;
ALTER TABLE "meta_pages" ADD COLUMN IF NOT EXISTS "capiTokenEnc" TEXT;

-- El «Lead» que sale al llegar un lead todavía no es de ninguna oportunidad.
ALTER TABLE "conversion_events" ALTER COLUMN "dealId" DROP NOT NULL;
ALTER TABLE "conversion_events" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "conversion_events" ADD COLUMN IF NOT EXISTS "metaPageId" TEXT;
ALTER TABLE "conversion_events" ADD COLUMN IF NOT EXISTS "leadgenId" TEXT;

-- Un cliente puede contar por las dos vías: una fila por oportunidad, evento y vía.
DROP INDEX IF EXISTS "conversion_events_dealId_eventName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_events_dealId_eventName_channel_key"
  ON "conversion_events"("dealId", "eventName", "channel");
CREATE INDEX IF NOT EXISTS "conversion_events_leadgenId_idx" ON "conversion_events"("leadgenId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversion_events_metaPageId_fkey') THEN
    ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_metaPageId_fkey"
      FOREIGN KEY ("metaPageId") REFERENCES "meta_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
