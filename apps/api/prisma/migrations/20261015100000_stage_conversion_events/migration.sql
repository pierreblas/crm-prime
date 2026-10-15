-- Conversiones de Meta por etapa: lista libre de eventos que se envían a Meta
-- (Conversions API) cuando una oportunidad de un anuncio llega a la etapa.
-- [{ "eventName": "Purchase", "withValue": true }, ...]
ALTER TABLE "pipeline_stages" ADD COLUMN "conversionEvents" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Lo que hasta ahora salía de los roles pasa a ser configuración explícita.
UPDATE "pipeline_stages" SET "conversionEvents" = '[{"eventName":"LeadSubmitted","withValue":false}]'::jsonb WHERE "isQualified" = true;
UPDATE "pipeline_stages" SET "conversionEvents" = '[{"eventName":"Purchase","withValue":true}]'::jsonb WHERE "isWon" = true;
