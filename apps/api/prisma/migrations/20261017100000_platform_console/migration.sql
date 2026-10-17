-- Consola de plataforma: notas internas y vencimiento del plan por empresa, y
-- registro de lo que hace el operador (cambios de plan, suspensiones, accesos).
ALTER TABLE "organizations" ADD COLUMN "platformNotes" TEXT;
ALTER TABLE "organizations" ADD COLUMN "planExpiresAt" TIMESTAMP(3);

CREATE TABLE "platform_audit_log" (
  "id"         TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "orgId"      TEXT,
  "details"    JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_log_orgId_createdAt_idx" ON "platform_audit_log"("orgId", "createdAt");
CREATE INDEX "platform_audit_log_createdAt_idx" ON "platform_audit_log"("createdAt");
ALTER TABLE "platform_audit_log"
  ADD CONSTRAINT "platform_audit_log_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Sin RLS: no es dato de ninguna empresa, es el diario del operador y solo lo
-- lee la consola (runUnscoped detrás de PlatformAdminGuard).
