-- IA de Driony medida en tokens. Los paquetes de conversaciones pasan a tokens
-- (20.000 por conversación, el gasto medio en producción) y el gasto de cada
-- paquete se apunta por mes y paquete, no por conversación.
ALTER TABLE "ai_packs" RENAME COLUMN "conversations" TO "tokens";
UPDATE "ai_packs" SET "tokens" = "tokens" * 20000, "used" = "used" * 20000;

ALTER TABLE "ai_pack_uses" ADD COLUMN "tokens" INTEGER NOT NULL DEFAULT 0;
-- Cada apunte antiguo era una conversación: se juntan por paquete y mes.
UPDATE "ai_pack_uses" u SET "tokens" = s.n * 20000
  FROM (SELECT "orgId", "packId", "month", count(*) AS n, min(id) AS id FROM "ai_pack_uses" GROUP BY 1, 2, 3) s
  WHERE s.id = u.id;
DELETE FROM "ai_pack_uses" u
  WHERE EXISTS (SELECT 1 FROM "ai_pack_uses" o WHERE o."orgId" = u."orgId" AND o."packId" = u."packId" AND o."month" = u."month" AND o.id < u.id);
DROP INDEX IF EXISTS "ai_pack_uses_orgId_conversationId_month_key";
ALTER TABLE "ai_pack_uses" DROP COLUMN "conversationId";
CREATE UNIQUE INDEX "ai_pack_uses_orgId_packId_month_key" ON "ai_pack_uses"("orgId", "packId", "month");
