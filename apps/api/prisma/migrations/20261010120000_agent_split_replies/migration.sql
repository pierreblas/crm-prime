-- Agente: responder en varios mensajes cortos (como escribe una persona).
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "splitReplies" BOOLEAN NOT NULL DEFAULT false;
