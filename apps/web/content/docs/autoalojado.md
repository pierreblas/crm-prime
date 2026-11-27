# Versión open source

Driony es código abierto bajo licencia **AGPL-3.0**. Puedes instalar el CRM completo en tu propio servidor, para una empresa, con tus datos en tu base y tus propias claves. El código está en [GitHub](https://github.com/jusiho/crm-prime).

## Qué incluye

Todo lo que describe esta documentación —bandeja, agentes, flujos, embudos, difusiones, API y webhooks— para **una sola empresa**. Lo que añade la nube es el multiempresa (subdominios, aislamiento, alta automática), la conexión de WhatsApp con un clic a través de la app de Meta de la plataforma, y el alojamiento.

## Probarlo en cinco minutos

Necesitas Docker y Node 20.

```bash
git clone https://github.com/jusiho/crm-prime && cd crm-prime
npm install
npm run setup     # crea el .env, levanta Docker, migra y siembra
npm run dev
```

- Web: http://localhost:3000 — API: http://localhost:3001/api/v1
- Acceso de prueba: `admin@crm.local` / `admin1234`

O solo verlo funcionar, sin instalar nada: `npm run demo` levanta todo en contenedores con datos de ejemplo (no es para producción: los secretos están a la vista).

## Producción

`docker-compose.prod.yml` levanta base de datos (PostgreSQL con pgvector), Redis, API y web. Delante, un proxy con HTTPS (Nginx Proxy Manager, Caddy, Traefik). Las variables van en `.env.production` (`.env.example` explica cada una):

- `DATABASE_URL`, `REDIS_URL`, secretos JWT y `APP_ENCRYPTION_KEY` (cifra tokens y claves guardadas).
- `WHATSAPP_*`: tu app de Meta. El número se conecta desde **Ajustes › Canales** con su token; el webhook de Meta apunta a `https://tu-dominio/api/v1/whatsapp/webhook`.
- Las API keys de IA se ponen desde Ajustes › Inteligencia Artificial (o en el `.env` como respaldo).
- `MAIL_SMTP_*` y `MAIL_FROM` (opcional): el buzón que manda el enlace de «¿Olvidaste tu contraseña?», con `WEB_PUBLIC_URL` para que el enlace apunte a tu web. Sin él, el administrador genera el enlace en **Vendedores** y lo manda por WhatsApp.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Las imágenes, audios y documentos que llegan por WhatsApp (y las grabaciones de llamadas) se guardan en el volumen `crm-media` de la API (`MEDIA_DIR=/data/media`), así que sobreviven a los despliegues; inclúyelo en tus copias de seguridad junto con la base de datos. Si antes desplegabas sin ese volumen, los archivos anteriores se perdieron con el contenedor: la bandeja los muestra como «no disponible». Si prefieres que no ocupen el disco del servidor, mira [Guardar los archivos en Cloudflare R2](#guardar-los-archivos-en-cloudflare-r2-o-en-s3).

Las migraciones de base de datos se aplican solas al arrancar la API.

## Guardar los archivos en Cloudflare R2 (o en S3)

Por defecto los archivos se guardan en el disco del servidor. Puedes guardarlos en un almacén compatible con S3 (Cloudflare R2, Amazon S3, MinIO): así no ocupan el disco ni dependen de él.

1. En Cloudflare, **R2 Object Storage › Create bucket** (por ejemplo `driony-media`). Déjalo privado: Driony entrega los archivos por su API, con sesión, y no hace falta una dirección pública.
2. En la misma página, **API Tokens › Manage › Create Account API token**, con el permiso **Object Read & Write** aplicado solo a ese bucket. Copia el **Access Key ID** y el **Secret Access Key** (el secreto solo se enseña esa vez) y la dirección S3 de tu cuenta: `https://<cuenta>.r2.cloudflarestorage.com`.
3. Ponlos en el `.env`:

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<cuenta>.r2.cloudflarestorage.com
S3_BUCKET=driony-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

4. Vuelve a levantar la API y compruébalo. `check` guarda, lee y borra un archivo de prueba; si algo falla, dice qué revisar:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api
docker compose --env-file .env.production -f docker-compose.prod.yml exec api node dist/scripts/storage.js check
```

5. Sube lo que ya había en el disco. Se puede repetir las veces que haga falta: lo que ya subió no se repite.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api node dist/scripts/storage.js migrate
```

Lo que conviene saber:

- **Nada deja de verse.** Lo que había en el disco se sigue viendo desde el primer momento, antes del traslado.
- **Si el almacén no responde, no se pierde nada.** Los archivos nuevos se guardan en el disco y `migrate` los sube después. Por eso el volumen `crm-media` se mantiene.
- **Liberar el disco.** Cuando todo esté arriba, `migrate --delete-local` borra del disco cada archivo después de comprobar que está en el almacén.
- **Cómo va.** En la consola de la plataforma, **Salud › Archivos** dice dónde se guardan, si el almacén responde y cuántos archivos quedan todavía en el disco.
- Una configuración a medias no tumba el CRM: sigue guardando en el disco y lo avisa en el registro y en la consola.
- **Amazon S3**: deja `S3_ENDPOINT` vacío y pon `S3_REGION`. Con `S3_PREFIX` los archivos van a una carpeta dentro del bucket.

## Licencia

Puedes usar, modificar y desplegar el software libremente. Si lo ofreces como servicio a terceros, la AGPL te obliga a publicar tus modificaciones. Para usos que no encajen con esa condición, escríbenos para una licencia comercial.
