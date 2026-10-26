-- Feedback de las empresas: errores, sugerencias y opinión, que se leen en la consola de plataforma.
CREATE TABLE IF NOT EXISTS "feedback" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "userId"    TEXT,
  "kind"      TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'new',
  "message"   TEXT NOT NULL DEFAULT '',
  "rating"    INTEGER,
  "pagePath"  TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "feedback_orgId_createdAt_idx" ON "feedback"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "feedback_status_createdAt_idx" ON "feedback"("status", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_orgId_fkey') THEN
    ALTER TABLE "feedback" ADD CONSTRAINT "feedback_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_userId_fkey') THEN
    ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feedback_tenant_isolation" ON "feedback";
CREATE POLICY "feedback_tenant_isolation" ON "feedback"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
