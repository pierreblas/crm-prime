-- Cuando arranco el flujo en la conversacion: el disparador "llega un mensaje
-- del cliente" no vuelve a arrancar el mismo flujo antes de su pausa minima.
ALTER TABLE "flow_sessions" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
