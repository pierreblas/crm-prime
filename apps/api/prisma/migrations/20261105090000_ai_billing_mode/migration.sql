-- Modalidad de facturación de la IA (MANAGED | BYOK), estado de la clave propia
-- e historial de los ajustes de IA; consumo con la modalidad fijada por llamada.
--
-- Regla de arranque: quien ya tiene una clave guardada sigue con la suya (BYOK)
-- y el resto queda en la IA incluida (MANAGED). Nadie cambia de comportamiento
-- el día del despliegue. Idempotente: se puede volver a ejecutar sin romper nada.

-- ── ai_settings ──────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_settings' AND column_name = 'billingMode'
  ) THEN
    ALTER TABLE "ai_settings" ADD COLUMN "billingMode" TEXT NOT NULL DEFAULT 'MANAGED';
    ALTER TABLE "ai_settings" ADD COLUMN "credentialStatus" TEXT NOT NULL DEFAULT 'unconfigured';
    ALTER TABLE "ai_settings" ADD COLUMN "validatedAt" TIMESTAMP(3);
    ALTER TABLE "ai_settings" ADD COLUMN "rotatedAt" TIMESTAMP(3);
    ALTER TABLE "ai_settings" ADD COLUMN "updatedBy" TEXT;

    -- Solo la primera vez: la modalidad sigue a la clave que ya existe. Una
    -- clave guardada antes de hoy existe pero no se ha probado con el nuevo botón.
    UPDATE "ai_settings"
       SET "billingMode" = 'BYOK', "credentialStatus" = 'untested'
     WHERE "openaiKeyEnc" IS NOT NULL OR "anthropicKeyEnc" IS NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_billing_mode_check') THEN
    ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_billing_mode_check"
      CHECK ("billingMode" IN ('MANAGED', 'BYOK'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_credential_status_check') THEN
    ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_credential_status_check"
      CHECK ("credentialStatus" IN ('unconfigured', 'untested', 'valid', 'invalid', 'exhausted', 'revoked'));
  END IF;
END $$;

-- ── ai_usage ─────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_usage' AND column_name = 'billingMode'
  ) THEN
    ALTER TABLE "ai_usage" ADD COLUMN "billingMode" TEXT;
    -- Lo ya registrado se etiqueta por de quién era la clave, que es lo mismo
    -- que medía `source`. Las filas nuevas traen la modalidad desde la llamada.
    UPDATE "ai_usage"
       SET "billingMode" = CASE WHEN "source" = 'platform' THEN 'MANAGED' ELSE 'BYOK' END
     WHERE "billingMode" IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_billing_mode_check') THEN
    ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_billing_mode_check"
      CHECK ("billingMode" IS NULL OR "billingMode" IN ('MANAGED', 'BYOK'));
  END IF;
END $$;

ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
-- La misma respuesta del proveedor no se registra dos veces. Los NULL (llamadas
-- sin id, filas antiguas) no chocan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_orgId_requestId_key" ON "ai_usage"("orgId", "requestId");

-- ── ai_setting_events ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_setting_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "provider" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_setting_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_setting_events_orgId_createdAt_idx" ON "ai_setting_events"("orgId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_setting_events_orgId_fkey') THEN
    ALTER TABLE "ai_setting_events" ADD CONSTRAINT "ai_setting_events_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_setting_events_action_check') THEN
    ALTER TABLE "ai_setting_events" ADD CONSTRAINT "ai_setting_events_action_check"
      CHECK ("action" IN ('mode_changed', 'key_set', 'key_rotated', 'key_revoked', 'settings_changed', 'test_ok', 'test_failed', 'budget_changed'));
  END IF;
END $$;

-- Tabla de empresa: mismo aislamiento por fila que el resto.
ALTER TABLE "ai_setting_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_setting_events_tenant_isolation" ON "ai_setting_events";
CREATE POLICY "ai_setting_events_tenant_isolation" ON "ai_setting_events"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
