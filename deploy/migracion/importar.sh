#!/usr/bin/env bash
# ============================================================
#  Driony · importar en el servidor nuevo lo que exportó exportar.sh
#
#  Se ejecuta EN EL SERVIDOR NUEVO, desde la carpeta del proyecto, con el
#  repositorio clonado y el archivo de variables en su sitio (el «env» de la
#  exportación copiado a .env.production). Exige una pila vacía: si ya hubo un
#  intento (el ensayo), bórralo antes con
#
#    docker compose --env-file .env.production -f docker-compose.prod.yml down -v
#
#  Pasos: levanta Postgres y Redis limpios → recrea el rol crm_app si lo había
#  → restaura la base → mete el dump de Redis → construye la imagen de la API
#  y descomprime los medios en su volumen. Luego arrancas todo con
#  «up -d --build» (la API aplica las migraciones que falten, si el código es
#  más nuevo que la base).
#
#  ENSAYO=1: para la prueba previa. No restaura Redis (así los seguimientos y
#  difusiones programados no se disparan dos veces) y te recuerda arrancar con
#  docker-compose.ensayo.yml, que deja a la API sin salida a internet.
#
#  Uso:
#    bash deploy/migracion/importar.sh exportacion/
#    ENSAYO=1 bash deploy/migracion/importar.sh exportacion/
#    APP_DB_PASSWORD=... bash deploy/migracion/importar.sh exportacion/   # si había crm_app
# ============================================================
set -euo pipefail

SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "Uso: $0 <carpeta de la exportación>" >&2; exit 1; }
SRC="$(cd "$SRC" && pwd)"
for f in db.dump redis.rdb media.tar.gz; do
  [ -f "$SRC/$f" ] || { echo "Falta $SRC/$f" >&2; exit 1; }
done
ENSAYO="${ENSAYO:-0}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-}"
if [ -z "$ENV_FILE" ]; then
  if [ -f .env.production ]; then ENV_FILE=.env.production; else ENV_FILE=.env; fi
fi
[ -f "$COMPOSE_FILE" ] || { echo "No encuentro $COMPOSE_FILE: ejecuta esto desde la carpeta del proyecto." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro el archivo de variables ($ENV_FILE). Copia el «env» de la exportación a .env.production." >&2; exit 1; }
if grep -q $'\r' "$ENV_FILE"; then
  echo "El archivo de variables tiene saltos de línea de Windows. Arréglalo con: sed -i 's/\\r\$//' $ENV_FILE" >&2
  exit 1
fi

leer() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r' ; }
DB_USER="$(leer DB_USER)"; DB_NAME="$(leer DB_NAME)"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || { echo "DB_USER / DB_NAME no están en $ENV_FILE." >&2; exit 1; }

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# La red del proxy tiene que existir antes: el compose la declara external.
PROXY_NETWORK="$(leer PROXY_NETWORK)"; PROXY_NETWORK="${PROXY_NETWORK:-npm_default}"
if ! docker network inspect "$PROXY_NETWORK" > /dev/null 2>&1; then
  echo "La red del proxy «$PROXY_NETWORK» no existe. Levanta primero Nginx Proxy Manager (o nginx) o ajusta PROXY_NETWORK en $ENV_FILE." >&2
  echo "Redes disponibles:" >&2; docker network ls --format '  {{.Name}}' >&2
  exit 1
fi

# Pila vacía: si Postgres ya tiene tablas, parar.
echo "→ Levantando Postgres y Redis"
dc up -d db redis
for _ in $(seq 1 60); do
  dc exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1 && break
  sleep 1
done
tablas="$(dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from pg_tables where schemaname='public'" | tr -d '\r')"
if [ "${tablas:-0}" != "0" ]; then
  echo "La base $DB_NAME ya tiene $tablas tablas. Esto importa solo sobre una pila vacía:" >&2
  echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE down -v   # borra los volúmenes" >&2
  exit 1
fi

# ── Rol restringido crm_app (si la base original lo tenía) ──
if [ -s "$SRC/roles.txt" ]; then
  : "${APP_DB_PASSWORD:?La base original tenía el rol crm_app: pasa su contraseña en APP_DB_PASSWORD (la de la DATABASE_URL de la aplicación)}"
  echo "→ Recreando el rol crm_app"
  dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v pass="$APP_DB_PASSWORD" -f - < scripts/create-app-role.sql
fi

# ── Postgres ────────────────────────────────────────────────
echo "→ Restaurando la base ($(du -h "$SRC/db.dump" | cut -f1))"
dc exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error < "$SRC/db.dump"
echo "   tablas: $(dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from pg_tables where schemaname='public'" | tr -d '\r')"
echo "   migraciones aplicadas: $(dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc 'select count(*) from "_prisma_migrations" where finished_at is not null' | tr -d '\r')"
echo "   empresas: $(dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc 'select count(*) from organizations' 2>/dev/null | tr -d '\r' || echo '?')"

# ── Redis ───────────────────────────────────────────────────
if [ "$ENSAYO" = "1" ]; then
  echo "→ Redis: ENSAYO, se deja vacío (los trabajos programados solo se restauran en el corte real)"
else
  echo "→ Redis: metiendo dump.rdb"
  dc stop redis
  dc cp "$SRC/redis.rdb" redis:/data/dump.rdb
  dc start redis
  sleep 2
  echo "   claves: $(dc exec -T redis redis-cli DBSIZE | tr -d '\r')"
fi

# ── Medios ──────────────────────────────────────────────────
echo "→ Construyendo la imagen de la API (sin arrancarla) y restaurando los medios"
dc build api
dc run --rm --no-deps --entrypoint sh -v "$SRC:/backup:ro" api -c \
  'mkdir -p /data/media && tar xzf /backup/media.tar.gz -C /data/media && echo "   archivos: $(find /data/media -type f | wc -l)"'

echo
if [ "$ENSAYO" = "1" ]; then
  echo "Importado para ENSAYO. Arranca con la API sin salida a internet:"
  echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE -f deploy/migracion/docker-compose.ensayo.yml up -d --build"
  echo "Cuando termines de probar, deja la pila vacía para el corte real:"
  echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE down -v"
else
  echo "Importado. Ahora:"
  echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d --build"
  echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f api   # «Aplicando migraciones…» y luego «Iniciando servidor»"
fi
