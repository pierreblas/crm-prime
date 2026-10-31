-- Varios disparadores por flujo: una lista [{ id, type, keywords, config }].
-- Cada flujo existente pasa su disparador de siempre a la lista. Los de
-- "manual" (solo desde el embudo) quedan con la lista vacia, que ahora
-- significa eso mismo. Las columnas antiguas se mantienen (la API las sigue
-- rellenando con el primer disparador) para poder volver atras sin perder nada.
ALTER TABLE "flows" ADD COLUMN IF NOT EXISTS "triggers" JSONB NOT NULL DEFAULT '[]';

UPDATE "flows"
SET "triggers" = jsonb_build_array(
  jsonb_build_object(
    'id', 'trg_1',
    'type', "triggerType",
    'keywords', to_jsonb(COALESCE("triggerKeywords", ARRAY[]::text[])),
    'config', COALESCE("triggerConfig", '{}'::jsonb)
  )
)
WHERE "triggerType" <> 'manual' AND "triggers" = '[]'::jsonb;
