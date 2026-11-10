-- Messenger e Instagram como canales de la bandeja, encima de la página de
-- Facebook ya conectada para los leads: la página guarda si cada canal está
-- encendido, su cuenta de Instagram y quién lo atiende; la conversación dice de
-- qué canal es y de qué página cuelga; el contacto guarda su id de Meta.
-- Idempotente: se puede volver a ejecutar sin romper nada.

ALTER TABLE "meta_pages"
  ADD COLUMN IF NOT EXISTS "messengerEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "instagramEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "instagramId" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "messagingSubscribedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "messagingError" TEXT,
  ADD COLUMN IF NOT EXISTS "messengerBotId" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramBotId" TEXT,
  ADD COLUMN IF NOT EXISTS "messengerPipelineId" TEXT,
  ADD COLUMN IF NOT EXISTS "instagramPipelineId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "meta_pages_instagramId_key" ON "meta_pages"("instagramId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_messengerBotId_fkey') THEN
    ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_messengerBotId_fkey" FOREIGN KEY ("messengerBotId") REFERENCES "agent_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_instagramBotId_fkey') THEN
    ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_instagramBotId_fkey" FOREIGN KEY ("instagramBotId") REFERENCES "agent_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_messengerPipelineId_fkey') THEN
    ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_messengerPipelineId_fkey" FOREIGN KEY ("messengerPipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_instagramPipelineId_fkey') THEN
    ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_instagramPipelineId_fkey" FOREIGN KEY ("instagramPipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "channelKind" TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS "metaPageId" TEXT;
CREATE INDEX IF NOT EXISTS "conversations_metaPageId_idx" ON "conversations"("metaPageId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_metaPageId_fkey') THEN
    ALTER TABLE "conversations" ADD CONSTRAINT "conversations_metaPageId_fkey" FOREIGN KEY ("metaPageId") REFERENCES "meta_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "fbPsid" TEXT,
  ADD COLUMN IF NOT EXISTS "igsid" TEXT;
CREATE INDEX IF NOT EXISTS "contacts_orgId_fbPsid_idx" ON "contacts"("orgId", "fbPsid");
CREATE INDEX IF NOT EXISTS "contacts_orgId_igsid_idx" ON "contacts"("orgId", "igsid");
