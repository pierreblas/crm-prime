-- Diagnóstico de un número: cuándo llegó el último evento de Meta para él.
-- Separa «Meta no envía nada» de «llega pero no se procesa».
ALTER TABLE "whatsapp_connections" ADD COLUMN "lastWebhookAt" TIMESTAMP(3);
