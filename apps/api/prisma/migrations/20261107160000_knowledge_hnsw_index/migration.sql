-- Índice vectorial de knowledge_chunks (Prisma no lo expresa en el schema).
--
-- Hasta ahora lo creaba la API al arrancar. Con la aplicación conectada como
-- crm_app (sin privilegios de dueño) ese CREATE INDEX falla con 42501, así que
-- pasa a vivir aquí, donde corre el dueño. Donde ya existe, no hace nada.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
