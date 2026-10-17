-- Retención de adjuntos por plan: cuando el archivo se borra del almacén, el
-- mensaje conserva su texto y marca cuándo se eliminó el adjunto.
ALTER TABLE "messages" ADD COLUMN "mediaPurgedAt" TIMESTAMP(3);
