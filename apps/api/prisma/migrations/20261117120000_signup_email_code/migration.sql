-- Confirmar el correo al dar de alta una empresa: un código de 6 cifras que
-- llega al correo del administrador y sin el cual no se crea la empresa.
--
-- La tabla es anterior a la empresa (el código se pide antes de crearla): sin
-- orgId y sin RLS, igual que platform_audit_log. Se guarda el HMAC del código,
-- nunca el código. En users, la fecha en que se confirmó el correo.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

CREATE TABLE IF NOT EXISTS "signup_verifications" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signup_verifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "signup_verifications_email_key" ON "signup_verifications"("email");
CREATE INDEX IF NOT EXISTS "signup_verifications_expiresAt_idx" ON "signup_verifications"("expiresAt");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
