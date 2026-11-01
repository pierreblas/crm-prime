-- Conversaciones con IA extra (paquetes) y su gasto por conversación y mes.
-- Idempotente: se puede volver a ejecutar sin romper nada.

CREATE TABLE IF NOT EXISTS "ai_packs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversations" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER,
    "note" TEXT,
    "createdBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_packs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_pack_uses" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_pack_uses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_packs_orgId_expiresAt_idx" ON "ai_packs"("orgId", "expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_pack_uses_orgId_conversationId_month_key" ON "ai_pack_uses"("orgId", "conversationId", "month");
CREATE INDEX IF NOT EXISTS "ai_pack_uses_packId_idx" ON "ai_pack_uses"("packId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_packs_orgId_fkey') THEN
    ALTER TABLE "ai_packs" ADD CONSTRAINT "ai_packs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_pack_uses_orgId_fkey') THEN
    ALTER TABLE "ai_pack_uses" ADD CONSTRAINT "ai_pack_uses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_pack_uses_packId_fkey') THEN
    ALTER TABLE "ai_pack_uses" ADD CONSTRAINT "ai_pack_uses_packId_fkey" FOREIGN KEY ("packId") REFERENCES "ai_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Nunca se gasta más de lo comprado ni queda saldo negativo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_packs_used_check') THEN
    ALTER TABLE "ai_packs" ADD CONSTRAINT "ai_packs_used_check" CHECK ("conversations" > 0 AND "used" >= 0 AND "used" <= "conversations");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_packs_price_check') THEN
    ALTER TABLE "ai_packs" ADD CONSTRAINT "ai_packs_price_check" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
  END IF;
END $$;

ALTER TABLE "ai_packs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_packs_tenant_isolation" ON "ai_packs";
CREATE POLICY "ai_packs_tenant_isolation" ON "ai_packs"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );

ALTER TABLE "ai_pack_uses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_pack_uses_tenant_isolation" ON "ai_pack_uses";
CREATE POLICY "ai_pack_uses_tenant_isolation" ON "ai_pack_uses"
  USING (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  )
  WITH CHECK (
    current_setting('app.current_org', true) = '*'
    OR "orgId" = current_setting('app.current_org', true)
  );
