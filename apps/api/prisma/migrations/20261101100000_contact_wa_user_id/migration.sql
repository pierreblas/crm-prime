-- Usuarios de WhatsApp: Meta manda con cada mensaje un identificador de
-- usuario (BSUID) y, si el cliente usa nombre de usuario y no comparte su
-- número, solo eso. Se guarda para reconocer a la persona y su usuario para
-- mostrarlo.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "waUserId" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "waUsername" TEXT;
CREATE INDEX IF NOT EXISTS "contacts_orgId_waUserId_idx" ON "contacts"("orgId", "waUserId");
