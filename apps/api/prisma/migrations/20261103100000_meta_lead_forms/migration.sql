-- Formularios de Meta: en qué etapa entra la oportunidad de los leads de una
-- página y, por formulario, si se importa y a qué etapa va.
ALTER TABLE "meta_pages" ADD COLUMN IF NOT EXISTS "dealStageId" TEXT;
ALTER TABLE "meta_pages" ADD COLUMN IF NOT EXISTS "formRules" JSONB;
