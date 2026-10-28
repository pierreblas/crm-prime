-- Automatizaciones de etapa: filtros (solo actúan con quien los cumple).
-- La espera de «entra a la etapa» reutiliza "delayMinutes".
ALTER TABLE "stage_automations" ADD COLUMN IF NOT EXISTS "conditions" JSONB;
