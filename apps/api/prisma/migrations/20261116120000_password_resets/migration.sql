-- Recuperar la contraseña: enlaces de un solo uso que pide la persona por
-- correo o que genera un administrador (o el operador desde la consola). Se
-- guarda el hash del enlace, nunca el enlace. Idempotente.

CREATE TABLE IF NOT EXISTS "password_resets" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "via" TEXT NOT NULL,
  "createdBy" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "password_resets_tokenHash_key" ON "password_resets"("tokenHash");
CREATE INDEX IF NOT EXISTS "password_resets_userId_createdAt_idx" ON "password_resets"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "password_resets_orgId_idx" ON "password_resets"("orgId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_resets_orgId_fkey') THEN
    ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_resets_userId_fkey') THEN
    ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Aislamiento por empresa, como el resto de tablas con orgId. Canjear un enlace
-- ocurre antes de saber la empresa: va por runUnscoped, que la política reconoce.
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "password_resets_tenant_isolation" ON "password_resets";
CREATE POLICY "password_resets_tenant_isolation" ON "password_resets"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
