-- La bandeja se ordena por lo último que se envió, sea del cliente, del equipo,
-- de la IA, de un flujo, de una difusión o una plantilla.
--
-- Lo mantiene un trigger y no el código: los mensajes se guardan desde muchos
-- sitios (bandeja, agente, flujos, citas, difusiones, celular, historial
-- importado) y los de salida no actualizaban la fecha. Nunca retrocede: un
-- mensaje viejo importado no mueve el chat.
--
-- `lastInboundAt` es cuándo escribió el cliente por última vez: de ahí sale
-- cuánto lleva esperando, que una difusión posterior no debe reiniciar.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);

-- Un chat nace con fecha: sin ella, la lista lo ponía arriba del todo.
ALTER TABLE "conversations" ALTER COLUMN "lastMessageAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION conversations_touch_last_message() RETURNS trigger AS $$
BEGIN
  UPDATE "conversations" SET
    "lastMessageAt" = GREATEST("lastMessageAt", NEW."createdAt"),
    "lastInboundAt" = CASE WHEN NEW."direction" = 'INBOUND' THEN GREATEST("lastInboundAt", NEW."createdAt") ELSE "lastInboundAt" END
  WHERE "id" = NEW."conversationId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_touch_conversation ON "messages";
CREATE TRIGGER messages_touch_conversation
  AFTER INSERT ON "messages"
  FOR EACH ROW EXECUTE FUNCTION conversations_touch_last_message();

-- Lo que ya hay: la fecha de su último mensaje y la del último del cliente.
UPDATE "conversations" c SET
  "lastMessageAt" = GREATEST(c."lastMessageAt", m.last_any),
  "lastInboundAt" = GREATEST(c."lastInboundAt", m.last_in)
FROM (
  SELECT "conversationId",
         max("createdAt") AS last_any,
         max("createdAt") FILTER (WHERE "direction" = 'INBOUND') AS last_in
  FROM "messages" GROUP BY "conversationId"
) m
WHERE m."conversationId" = c."id";

-- Abiertos sin ningún mensaje.
UPDATE "conversations" SET "lastMessageAt" = "createdAt" WHERE "lastMessageAt" IS NULL;
