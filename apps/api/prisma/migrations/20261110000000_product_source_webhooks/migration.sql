-- Webhooks de entrada de los catálogos conectados: cada conexión tiene un
-- token propio en su URL de aviso; la tienda (WooCommerce, Shopify, un Apps
-- Script de una hoja) llama y Driony relee el catálogo al momento. Idempotente.

ALTER TABLE "product_sources"
  ADD COLUMN IF NOT EXISTS "webhookToken" TEXT,
  ADD COLUMN IF NOT EXISTS "webhookRegisteredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "webhookError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastWebhookAt" TIMESTAMP(3);

-- Las conexiones que ya existan reciben su token.
UPDATE "product_sources"
SET "webhookToken" = md5(random()::text || clock_timestamp()::text || id) || md5(clock_timestamp()::text || random()::text)
WHERE "webhookToken" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "product_sources_webhookToken_key" ON "product_sources"("webhookToken");
