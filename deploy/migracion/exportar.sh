#!/usr/bin/env bash
# ============================================================
#  Driony · exportar todo lo que vive en este servidor
#
#  Se ejecuta EN EL SERVIDOR ACTUAL, desde la carpeta del proyecto (donde está
#  docker-compose.prod.yml). Deja una carpeta fechada con:
#
#    db.dump         Postgres completo (pg_dump -Fc): datos, _prisma_migrations,
#                    políticas RLS y la extensión vector
#    roles.txt       si existe el rol restringido crm_app (se recrea al importar)
#    redis.rdb       Redis: trabajos pendientes de BullMQ (seguimientos
#                    «si no responde en X horas», automatizaciones de etapa,
#                    difusiones programadas)
#    media.tar.gz    el volumen crm-media: imágenes, audios y documentos de
#                    WhatsApp (sin esto la bandeja los muestra «no disponible»)
#    env             copia del archivo de variables (con secretos: cuídala)
#    git-status.txt  cambios locales del servidor (git-local.diff, su contenido)
#    manifest.txt    commit, fecha, tamaños, versión de Postgres
#
#  Sirve igual como copia de seguridad: ponlo en cron y llévate la carpeta
#  fuera del servidor (rclone, scp…). Se puede ejecutar con la aplicación en
#  marcha; para el corte definitivo, para antes api y web (ver el runbook).
#
#  Uso:
#    bash deploy/migracion/exportar.sh [carpeta-destino]
#    ENV_FILE=.env bash deploy/migracion/exportar.sh   # si tus variables van en .env
# ============================================================
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-}"
if [ -z "$ENV_FILE" ]; then
  if [ -f .env.production ]; then ENV_FILE=.env.production; else ENV_FILE=.env; fi
fi
[ -f "$COMPOSE_FILE" ] || { echo "No encuentro $COMPOSE_FILE: ejecuta esto desde la carpeta del proyecto." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No encuentro el archivo de variables ($ENV_FILE)." >&2; exit 1; }

# Lee una variable del archivo de variables sin ejecutarlo (quita comillas y \r).
leer() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r' ; }
DB_USER="$(leer DB_USER)"; DB_NAME="$(leer DB_NAME)"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || { echo "DB_USER / DB_NAME no están en $ENV_FILE." >&2; exit 1; }

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

OUT="${1:-exportacion-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
echo "→ Exportando a $OUT"

# ── Postgres ────────────────────────────────────────────────
echo "→ Postgres: pg_dump de $DB_NAME"
dc exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT/db.dump"
dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select rolname from pg_roles where rolname='crm_app'" | tr -d '\r' > "$OUT/roles.txt"
dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select version()" | tr -d '\r' > "$OUT/pg-version.txt"
if [ -s "$OUT/roles.txt" ]; then
  echo "   la base tiene el rol restringido crm_app: al importar se recrea con scripts/create-app-role.sql"
fi

# ── Redis ───────────────────────────────────────────────────
echo "→ Redis: BGSAVE y copia de dump.rdb"
antes="$(dc exec -T redis redis-cli LASTSAVE | tr -d '\r')"
dc exec -T redis redis-cli BGSAVE > /dev/null
for _ in $(seq 1 60); do
  ahora="$(dc exec -T redis redis-cli LASTSAVE | tr -d '\r')"
  [ "$ahora" != "$antes" ] && break
  sleep 1
done
dc cp redis:/data/dump.rdb "$OUT/redis.rdb"

# ── Medios de WhatsApp (volumen crm-media) ──────────────────
echo "→ Medios: tar del volumen crm-media"
dc run --rm --no-deps --entrypoint sh -v "$OUT:/backup" api -c \
  'if [ -d /data/media ]; then cd /data/media && tar czf /backup/media.tar.gz . ; else echo "   (sin medios todavía)"; tar czf /backup/media.tar.gz -T /dev/null; fi'

# ── Estado del código: lo que este servidor corre y no está en git ──
LOCALES=no
if git rev-parse HEAD > /dev/null 2>&1; then
  # Las carpetas de exportación no son cambios del código: sin este filtro el
  # aviso de abajo saltaría siempre.
  base="$(basename "$OUT")"
  git status --short | { grep -vE "^[?][?] (exportacion-[^/]*|corte|$base)/\$" || true; } > "$OUT/git-status.txt"
  git diff > "$OUT/git-local.diff"
  chmod 600 "$OUT/git-local.diff"
  if [ -s "$OUT/git-status.txt" ]; then
    LOCALES=si
    echo "   OJO: este servidor tiene cambios sin subir a git (git-status.txt, git-local.diff)."
    echo "   Hay que llevarlos al servidor nuevo: un clon limpio no los tendría."
  fi
fi

# ── Variables y manifiesto ──────────────────────────────────
cp "$ENV_FILE" "$OUT/env"
chmod 600 "$OUT/env" "$OUT/db.dump" "$OUT/redis.rdb"
{
  echo "fecha: $(date -Is)"
  echo "host: $(hostname)"
  echo "commit: $(git rev-parse HEAD 2>/dev/null || echo '?')"
  echo "compose: $COMPOSE_FILE  env: $ENV_FILE"
  echo "postgres: $(cat "$OUT/pg-version.txt")"
  echo "rol crm_app: $([ -s "$OUT/roles.txt" ] && echo si || echo no)"
  echo "cambios locales sin subir: $LOCALES"
  echo "tamaños:"; du -h "$OUT"/db.dump "$OUT"/redis.rdb "$OUT"/media.tar.gz
} | tee "$OUT/manifest.txt"

echo
echo "Listo. Llévate la carpeta completa al servidor nuevo, por ejemplo:"
echo "  rsync -avz --progress '$OUT/' usuario@IP-NUEVA:~/crm-prime/exportacion/"
