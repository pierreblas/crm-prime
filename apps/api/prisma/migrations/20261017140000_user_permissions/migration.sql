-- Permisos por persona del equipo (qué ve, qué secciones abre, qué puede hacer).
-- NULL = lo de siempre para su rol: un vendedor ve sus fuentes y todas las secciones.
ALTER TABLE "users" ADD COLUMN "permissions" JSONB;
