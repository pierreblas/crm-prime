-- Campos del lead. Un contacto es la persona; un lead es un interés concreto
-- suyo (la oportunidad del embudo). Lo que alguien responde en un formulario y
-- la campaña por la que llegó son de ese interés, así que ahora se guardan en
-- la oportunidad:
--
--   deals.fields         respuestas y campos del lead, por clave
--   deals.origin         cómo llegó: formulario, campaña, anuncio, UTM y fecha
--   custom_fields.entity "contact" (la persona) o "deal" (el lead)
--   meta_leads.dealId    a qué oportunidad fue a parar cada lead de Meta
--
-- Idempotente: se puede volver a ejecutar sin romper nada. Solo añade y copia;
-- en los contactos no se borra ningún dato.

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "fields" JSONB;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "origin" JSONB;
ALTER TABLE "custom_fields" ADD COLUMN IF NOT EXISTS "entity" TEXT NOT NULL DEFAULT 'contact';
ALTER TABLE "meta_leads" ADD COLUMN IF NOT EXISTS "dealId" TEXT;

CREATE INDEX IF NOT EXISTS "meta_leads_dealId_idx" ON "meta_leads"("dealId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_leads_dealId_fkey') THEN
    ALTER TABLE "meta_leads"
      ADD CONSTRAINT "meta_leads_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Lo que sigue recorre todas las empresas (las políticas dejan pasar '*').
SELECT set_config('app.current_org', '*', true);

-- Los leads de formulario que ya llegaron: cada uno se enlaza con la
-- oportunidad que tenía su contacto en ese momento (la última creada hasta diez
-- minutos después del lead; si no hay, la primera que tuvo).
UPDATE "meta_leads" ml SET "dealId" = pick.deal_id
FROM (
  SELECT l."id" AS lead_id,
         COALESCE(
           (SELECT d."id" FROM "deals" d
             WHERE d."contactId" = l."contactId" AND d."createdAt" <= l."createdAt" + interval '10 minutes'
             ORDER BY d."createdAt" DESC LIMIT 1),
           (SELECT d."id" FROM "deals" d WHERE d."contactId" = l."contactId" ORDER BY d."createdAt" ASC LIMIT 1)
         ) AS deal_id
  FROM "meta_leads" l
  WHERE l."contactId" IS NOT NULL AND l."status" = 'PROCESSED' AND l."dealId" IS NULL
) pick
WHERE pick.lead_id = ml."id" AND pick.deal_id IS NOT NULL;

-- Y esa oportunidad guarda cómo llegó: lo de su lead más reciente.
UPDATE "deals" d SET "origin" = jsonb_strip_nulls(jsonb_build_object(
  'form', l."formName",
  'formId', l."formId",
  'campaign', l."campaignName",
  'ad', l."adName",
  'platform', l."platform",
  'at', to_char(l."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
))
FROM (
  SELECT DISTINCT ON ("dealId") "dealId", "formName", "formId", "campaignName", "adName", "platform", "createdAt"
  FROM "meta_leads" WHERE "dealId" IS NOT NULL
  ORDER BY "dealId", "createdAt" DESC
) l
WHERE l."dealId" = d."id" AND d."origin" IS NULL;
