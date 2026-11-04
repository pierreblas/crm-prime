-- Lo que explica Driony de un mensaje sin texto escrito (contacto compartido,
-- pedido, ubicación, formulario, o lo que WhatsApp no entregó). Va aparte de
-- "content" para que flujos y palabras clave solo lean lo que escribió el cliente.
ALTER TABLE "messages" ADD COLUMN "note" TEXT;
