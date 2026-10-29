-- IA de Driony: de quién era la clave en cada llamada. "own" = la de la
-- empresa (o la del servidor en una instalación propia); "platform" = la de
-- Driony, que es la que cuenta para el cupo de conversaciones del plan.
-- Lo anterior queda como "own": antes no había IA incluida.
ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'own';
CREATE INDEX IF NOT EXISTS "ai_usage_orgId_source_createdAt_idx" ON "ai_usage"("orgId", "source", "createdAt");
