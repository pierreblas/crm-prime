-- Anuncio Click-to-WhatsApp de cada mensaje entrante que lo trae: un cliente
-- con el chat abierto puede volver por otro anuncio y hay que saber cuál.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "referral" JSONB;
