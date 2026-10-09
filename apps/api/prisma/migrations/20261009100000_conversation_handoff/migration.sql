-- La IA pasó el chat a una persona: cuándo y por qué. Se limpia cuando alguien
-- lo atiende (responde, lo abre o lo cierra).
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "handoffAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "handoffReason" TEXT;
