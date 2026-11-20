-- Descuentos de producto: `price` sigue siendo lo que se paga hoy; al lado, el
-- precio normal (el de antes) y hasta cuándo vale el descuento. Lo mismo por
-- moneda. Columnas opcionales: los productos que ya existen quedan sin descuento.
-- Idempotente.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "regularPrice" DECIMAL(12,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "saleEndsAt" TIMESTAMP(3);
ALTER TABLE "product_prices" ADD COLUMN IF NOT EXISTS "regularAmount" DECIMAL(12,2);

-- El barrido de vencidos busca por fecha de fin.
CREATE INDEX IF NOT EXISTS "products_saleEndsAt_idx" ON "products"("saleEndsAt");
