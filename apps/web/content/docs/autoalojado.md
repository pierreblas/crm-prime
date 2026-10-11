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

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

Las imágenes, audios y documentos que llegan por WhatsApp (y las grabaciones de llamadas) se guardan en el volumen `crm-media` de la API (`MEDIA_DIR=/data/media`), así que sobreviven a los despliegues; inclúyelo en tus copias de seguridad junto con la base de datos. Si antes desplegabas sin ese volumen, los archivos anteriores se perdieron con el contenedor: la bandeja los muestra como «no disponible».
```

Las migraciones de base de datos se aplican solas al arrancar la API.

## Licencia

Puedes usar, modificar y desplegar el software libremente. Si lo ofreces como servicio a terceros, la AGPL te obliga a publicar tus modificaciones. Para usos que no encajen con esa condición, escríbenos para una licencia comercial.
