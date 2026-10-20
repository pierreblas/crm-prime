-- Seguimientos automáticos: la secuencia va en el agente y el estado en cada
-- conversación (qué toque toca y cuándo). El barrido busca por "followUpDueAt".
ALTER TABLE "agent_configs" ADD COLUMN "followUps" JSONB;
ALTER TABLE "conversations" ADD COLUMN "followUpStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "conversations" ADD COLUMN "followUpDueAt" TIMESTAMP(3);
CREATE INDEX "conversations_followUpDueAt_idx" ON "conversations"("followUpDueAt");
