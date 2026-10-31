-- Prueba de Pro al darse de alta en la nube: hasta cuándo dura. Las empresas
-- que ya existían quedan sin prueba (NULL).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
