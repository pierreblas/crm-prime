-- Asistente de bienvenida: el perfil del negocio y cuándo se construyó la IA.
ALTER TABLE "onboarding_states" ADD COLUMN IF NOT EXISTS "business" JSONB;
ALTER TABLE "onboarding_states" ADD COLUMN IF NOT EXISTS "setupCompletedAt" TIMESTAMP(3);
