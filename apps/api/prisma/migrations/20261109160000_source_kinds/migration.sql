-- Las fuentes automáticas (WhatsApp, Anuncio de Meta, Formulario de Facebook,
-- Messenger, Instagram) se reconocen por su tipo, no por su nombre: así la
-- empresa puede renombrarlas sin que el siguiente mensaje cree otra. Y cada
-- canal (número de WhatsApp, página por Messenger / Instagram) puede apuntar a
-- otra fuente. Idempotente.

ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "kind" TEXT;
CREATE INDEX IF NOT EXISTS "sources_orgId_kind_idx" ON "sources"("orgId", "kind");

-- Las que ya existen con su nombre de nacimiento pasan a tener tipo.
UPDATE "sources" SET "kind" = 'whatsapp'  WHERE "kind" IS NULL AND "name" = 'WhatsApp';
UPDATE "sources" SET "kind" = 'ad'        WHERE "kind" IS NULL AND "name" = 'Anuncio de Meta';
UPDATE "sources" SET "kind" = 'form'      WHERE "kind" IS NULL AND "name" = 'Formulario de Facebook';
UPDATE "sources" SET "kind" = 'messenger' WHERE "kind" IS NULL AND "name" = 'Messenger';
UPDATE "sources" SET "kind" = 'instagram' WHERE "kind" IS NULL AND "name" = 'Instagram';

ALTER TABLE "whatsapp_connections" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "meta_pages"
  ADD COLUMN IF NOT EXISTS "messengerSourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramSourceId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_connections_sourceId_fkey') THEN
    ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_messengerSourceId_fkey') THEN
    ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_messengerSourceId_fkey" FOREIGN KEY ("messengerSourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_instagramSourceId_fkey') THEN
    ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_instagramSourceId_fkey" FOREIGN KEY ("instagramSourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
