-- Anuncio y campaña de cada lead de formulario de Meta (cuando Meta los da).
ALTER TABLE "meta_leads" ADD COLUMN IF NOT EXISTS "adName" TEXT;
ALTER TABLE "meta_leads" ADD COLUMN IF NOT EXISTS "campaignName" TEXT;
ALTER TABLE "meta_leads" ADD COLUMN IF NOT EXISTS "platform" TEXT;
