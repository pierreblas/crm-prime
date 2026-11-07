#!/bin/sh
set -e

# Las migraciones crean tablas: corren con el dueño (DATABASE_URL_MIGRATE).
# La aplicación puede conectarse con un rol restringido (DATABASE_URL), que
# es lo que hace que Row-Level Security proteja de verdad: el dueño de las
# tablas se salta las políticas. Sin DATABASE_URL_MIGRATE, todo va con la misma.
echo "[API] Aplicando migraciones de base de datos..."
DATABASE_URL="${DATABASE_URL_MIGRATE:-$DATABASE_URL}" npx prisma migrate deploy --schema=prisma/schema.prisma

echo "[API] Iniciando servidor..."
exec node dist/main.js
