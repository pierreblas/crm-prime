# Migrar Driony a otro servidor (con clientes en producción)

Runbook para mover la plataforma del servidor actual al nuevo sin perder datos
y con unos minutos de corte. Escrito el 2026-11-06 a partir de lo que hay en el
repositorio (`docker-compose.prod.yml`, `deploy/nginx/driony.conf`,
`.env.example.production`) y de la configuración de producción conocida:

| | |
|---|---|
| Alojamiento | VPS de Hostinger (el viejo) → VPS de otro proveedor (el nuevo) |
| DNS | Cloudflare con proxy activo en `driony.com`, `www`, `api`, `admin` y el comodín (comprobado el 2026-11-06) |
| Modo | `TENANCY_MODE=multi`, `SAAS_BASE_DOMAIN=driony.com` |
| Dominios | `driony.com` (landing y alta), `*.driony.com` (cada empresa), `api.driony.com` (API, webhook de Meta y WebSocket), `admin.driony.com` (consola) |
| Pila | Docker Compose: `db` (pgvector/pgvector:pg16), `redis` (7), `crm-api`, `crm-web` |
| Proxy | Nginx Proxy Manager, en la red Docker `n8n_default` (la pila de n8n del mismo servidor) |
| Estado | volúmenes `crm-db-data`, `crm-redis-data`, `crm-media`; el archivo de variables del servidor |
| Meta | el webhook y los dominios de la app apuntan a nombres, no a IPs: **no hay que tocar nada en Meta** si el dominio se queda |

La idea: **el servidor nuevo se prepara y se ensaya entero mientras el viejo
sigue atendiendo**. El corte real es parar la aplicación vieja, exportar,
importar, arrancar y cambiar el DNS. Diez o quince minutos sin servicio, de
madrugada, y el viejo queda apagado pero intacto por si hay que volver.

Herramientas en el repo:

- `deploy/migracion/exportar.sh`: en el servidor viejo. Saca base de datos, Redis, medios y variables a una carpeta. Sirve también de copia de seguridad.
- `deploy/migracion/importar.sh`: en el nuevo. Mete todo en una pila vacía.
- `deploy/migracion/docker-compose.ensayo.yml`: para el ensayo, deja a la API sin salida a internet, así la copia de prueba no escribe a ningún cliente, no dispara los webhooks salientes de las empresas y no gasta IA de nadie.

Los dos scripts y la capa de ensayo se probaron el 2026-11-06 en Ubuntu 24.04 con dos pilas desechables: base, rol `crm_app`, políticas RLS, Redis y medios llegaron idénticos, y los scripts se niegan a importar sobre una base con datos o sin la contraseña del rol. No se probó la imagen real de la API, Nginx Proxy Manager ni Cloudflare: eso lo cubre el ensayo del §3.

---

## 0. Lo que hay que decidir antes

1. **DNS: es Cloudflare con proxy.** Tres ventajas: el certificado comodín se emite por reto DNS-01 antes de tocar nada; el cambio de IP se aplica en segundos, porque los visitantes solo ven IPs de Cloudflare y no hay TTL que esperar; y la vuelta atrás es igual de rápida. Antes de empezar, anota en el panel de Cloudflare dos cosas: el modo de *SSL/TLS › Overview* (ver §2) y qué registros apuntan a la IP de Hostinger. Solo se cambian los de Driony, no los de n8n ni los de otros servicios.
2. **¿Se muda n8n?** El proxy (Nginx Proxy Manager) vive hoy en la red `n8n_default`. Si n8n no se mueve, en el nuevo servidor NPM va solo y `PROXY_NETWORK` cambia (normalmente `npm_default`). Alternativa sin NPM: `deploy/nginx/driony.conf` con certbot.
3. **Ventana.** La hora de menos conversaciones (mira el panel: suele ser 2–5 de la mañana). Aviso a los clientes el día antes: «mantenimiento de 15 minutos».
4. **El servidor nuevo.** Ubuntu 22.04/24.04, mínimo 2 vCPU y 4 GB (la imagen de Next se construye en el servidor y con menos memoria se queda sin ella), 40 GB de disco, Docker Engine + plugin Compose.

Y una regla que no se negocia: **el archivo de variables se copia del servidor
viejo tal cual**. `JWT_ACCESS_SECRET` es también la clave con la que se cifran
las API keys de IA y los tokens de WhatsApp guardados por cada empresa (no hay
`APP_ENCRYPTION_KEY` aparte). Si cambia, ninguna empresa puede usar su clave
ni su número hasta volver a introducirlos. La copia que tienes en el PC puede
estar desfasada: la buena es la del servidor.

---

## 1. Qué vive en el servidor viejo y cómo se mueve

| Qué | Dónde | Cómo se mueve | Si se pierde |
|---|---|---|---|
| Base de datos | volumen `crm-db-data` | `pg_dump -Fc` → `pg_restore` (`exportar.sh` / `importar.sh`) | Todo. |
| Medios de WhatsApp | volumen `crm-media` (`/data/media`) | tar del volumen | Fotos, audios y documentos antiguos salen como «no disponible». |
| Trabajos pendientes | Redis, volumen `crm-redis-data` | `dump.rdb` | Seguimientos «si no responde en X horas», automatizaciones de etapa con retraso y difusiones programadas que aún no se ejecutaron. Por eso se copia en el corte, no en el ensayo. |
| Variables y secretos | `.env.production` (o `.env`) del servidor | `scp` | Ver la regla de arriba. |
| Código | clon de git | `git clone` + mismo commit (lo apunta `manifest.txt`) | — |
| Proxy y certificado | Nginx Proxy Manager (volúmenes de NPM) | se vuelve a configurar a mano (son dos proxy hosts y un certificado) | — |
| DNS | Cloudflare | cambiar los registros A, con el proxy puesto | — |
| Meta | app de Meta | nada que cambiar (dominios) | — |

Las migraciones de Prisma viajan dentro del dump (`_prisma_migrations`): al
arrancar, `entrypoint.sh` ejecuta `migrate deploy` y no hace nada si el código es
el mismo, o aplica las nuevas si desplegaste código más reciente.

---

## 2. Dos días antes: preparar el servidor nuevo

Desde tu PC, como `root` o con `sudo`:

```bash
# Sistema y Docker
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y git rsync ufw
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

# El proyecto
git clone https://github.com/jusiho/crm-prime.git ~/crm-prime
cd ~/crm-prime && git checkout COMMIT-DEL-VIEJO   # en el viejo: git rev-parse HEAD
git checkout origin/main -- deploy/migracion      # los scripts son más nuevos que ese commit
```

**Mismo commit que el viejo.** La migración no se mezcla con un despliegue: si algo falla, tiene que quedar claro que es el servidor y no el código. Lo nuevo se despliega otro día. En el viejo mira también `git status`: si hay cambios locales sin subir, un clon limpio no los tendría (`exportar.sh` los guarda en `git-local.diff`). Fíjate sobre todo en el compose: el del repo conecta la aplicación con `DB_USER`, y si en producción usas el rol `crm_app` algo tiene que diferir.

**Acceso entre servidores.** En el viejo: `ssh-keygen -t ed25519` y `ssh-copy-id usuario@IP-NUEVA`. Si el proveedor nuevo tiene firewall en su panel, abre ahí 22, 80 y 443 además de `ufw`.

**El script en el viejo, sin `git pull`.** Los scripts existen desde el commit `c75032e` y producción puede ir por uno anterior. Un pull movería `HEAD` y ya no sabrías qué commit está corriendo. Anota el commit y copia solo el script desde tu PC, con `scp deploy/migracion/exportar.sh usuario@IP-VIEJA:~/exportar.sh`. En el viejo quítale los saltos de Windows con `sed -i 's/\r$//' ~/exportar.sh`. Se ejecuta desde la carpeta del proyecto, con `bash ~/exportar.sh`.

Las variables, **desde el servidor viejo** (no desde el PC):

```bash
# en tu PC, con acceso a los dos servidores
scp usuario@IP-VIEJA:~/crm-prime/.env.production usuario@IP-NUEVA:~/crm-prime/.env.production
# en el nuevo: quita \r por si acaso y ajusta la red del proxy
sed -i 's/\r$//' ~/crm-prime/.env.production
grep -E '^(PROXY_NETWORK|SAAS_BASE_DOMAIN|NEXT_PUBLIC_API_URL|WEB_ORIGIN)=' ~/crm-prime/.env.production
```

Si no recuerdas en qué carpeta está el proyecto en el viejo: `docker inspect crm-api --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`.

### El proxy

**Si el servidor nuevo ya tiene otro proyecto en los puertos 80 y 443** (nuestro caso: un Caddy ajeno), NPM escucha en otro puerto y Cloudflare le manda ahí solo el tráfico de Driony. El otro proyecto no se toca ni se reinicia.

- En el compose de NPM: `"8443:443"` y `"127.0.0.1:8181:81"`. El panel se abre con un túnel: `ssh -L 8181:127.0.0.1:8181 root@IP-NUEVA`.
- En Cloudflare, *Rules › Origin Rules*, deja guardada **sin activar** una regla con destino *Rewrite to port 8443* y esta expresión, añadiendo a la exclusión cualquier subdominio que siga en el servidor viejo:
  ```
  (http.host eq "driony.com") or (http.host wildcard "*.driony.com" and not http.host in {"gestor.driony.com" "_domainconnect.driony.com"})
  ```
  `gestor.driony.com` vive en otro servidor y no se migra. Pruébala antes del corte con una regla solo para `prueba-migracion.driony.com`: activar la general mientras el DNS apunta al viejo tumba producción, porque allí nada escucha en el 8443.
- **Nunca conectes el proxy del otro proyecto a una red con los contenedores de Driony.** Compose registra los alias `web` y `api` en cada red: si ese proxy usa `web:3000` y queda en las dos redes, el tráfico del otro proyecto podría acabar en Driony.
- La regla exige modo *Full* o *Full (strict)* y los registros con proxy: con *Flexible* o con la nube gris Driony no responde.

**Opción A, Nginx Proxy Manager** (lo que usas hoy). Levántalo en el nuevo (su
propio `docker-compose.yml` con los volúmenes `data` y `letsencrypt`), entra en
`http://IP-NUEVA:81` y configura:

1. *SSL Certificates › Add › Let's Encrypt*: dominios `driony.com` y `*.driony.com`, **Use a DNS Challenge**, proveedor Cloudflare, con un token propio (*My Profile › API Tokens*, plantilla *Edit zone DNS*, solo para la zona `driony.com`). Se puede emitir ya: el reto DNS no necesita que el dominio apunte al servidor. Cuenta: Let's Encrypt solo emite cinco certificados idénticos por semana, no lo repitas por probar.
2. *Proxy Host* `driony.com, www.driony.com, *.driony.com` → `http://crm-web:3000`, **Websockets Support** activado, el certificado comodín, *Force SSL*.
3. *Proxy Host* `api.driony.com` → `http://crm-api:3001`, **Websockets Support** activado (el WebSocket de la bandeja en vivo), el mismo certificado. En *Advanced* añade `client_max_body_size 25m;` (sin esto subir una imagen da 413).
4. Anota el nombre de la red de NPM (`docker network ls`) y ponlo en `PROXY_NETWORK` del `.env.production`.

**Modo SSL de Cloudflare.** Con el comodín de Let's Encrypt en el servidor nuevo, el modo correcto es *Full (strict)*. Si hoy está en *Flexible*, Cloudflare llega al servidor por HTTP y el *Force SSL* del proxy host provoca un bucle de redirecciones. En ese caso cámbialo en el minuto del corte, no antes: el servidor viejo podría no tener certificado válido.

**Opción B, nginx a pelo.** `apt install nginx certbot python3-certbot-dns-cloudflare`, copia `deploy/nginx/driony.conf` a `/etc/nginx/sites-available/`, emite el comodín con certbot (comando en la cabecera del fichero) y expone `crm-api` y `crm-web` en `127.0.0.1:3001/3000` (añade `ports` en un override). Es más trabajo hoy, pero queda en el repo y se reproduce.

### Construir las imágenes antes

Tarda varios minutos y es lo que más memoria pide. Hazlo ahora, no en el corte:

```bash
cd ~/crm-prime
docker compose --env-file .env.production -f docker-compose.prod.yml build
```

Si el build de `web` muere sin mensaje, es memoria: añade swap (`fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`).

---

## 3. Un día antes: ensayo con una copia real

En el viejo, con la aplicación en marcha (no molesta):

```bash
cd ~/crm-prime
bash ~/exportar.sh
# → exportacion-AAAAMMDD-HHMMSS/ con manifest.txt
rsync -avz --progress exportacion-*/ usuario@IP-NUEVA:~/crm-prime/exportacion/
```

En el nuevo:

```bash
cd ~/crm-prime
ENSAYO=1 bash deploy/migracion/importar.sh exportacion/
docker compose --env-file .env.production -f docker-compose.prod.yml \
  -f deploy/migracion/docker-compose.ensayo.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

El ensayo arranca **sin Redis restaurado y con la API sin salida a
internet**: los seguimientos y difusiones que estaban programados no se disparan dos
veces, y nada de lo que hagas en la copia le llega a un cliente.

Para probarlo sin tocar el DNS, en tu PC apunta los nombres a la IP nueva
(`C:\Windows\System32\drivers\etc\hosts` o `/etc/hosts`):

```
IP-NUEVA  driony.com www.driony.com api.driony.com admin.driony.com  nombre-de-una-empresa.driony.com
```

Con NPM en el 8443 el archivo hosts no sirve, porque no puede cambiar el puerto. Usa una ventana aparte de Chrome, que además no deja nada que limpiar:

```
chrome --user-data-dir=%TEMP%\ensayo-driony --disable-quic --host-resolver-rules="MAP driony.com:443 IP-NUEVA:8443, MAP *.driony.com:443 IP-NUEVA:8443"
```

Comprueba, con el certificado real ya puesto:

- `https://driony.com` carga la landing; `https://api.driony.com/api/v1` responde (un 404 es correcto: esa ruta no existe, pero la petición llegó a la API).
- Entras en una empresa (`https://<slug>.driony.com`) con un usuario real: la bandeja muestra los chats y **las fotos y audios antiguos se ven** (medios restaurados).
- La bandeja en vivo conecta (en la consola del navegador no hay errores de `socket.io`; en NPM es el *Websockets Support*).
- `https://admin.driony.com` entra con la cuenta maestra.
- Alta de una empresa de prueba en `https://driony.com/register` (en el ensayo no importa; la pila se borra después).
- Ajustes › IA de una empresa muestra la clave como «configurada»: si saliera «no se pudo descifrar», el `.env.production` no es el del servidor.

El archivo hosts se salta Cloudflare, así que prueba también ese tramo: crea en Cloudflare un registro A `prueba-migracion` → IP nueva, con proxy, y abre `https://prueba-migracion.driony.com`. Tiene que responder la aplicación, no un error 52x. Es invisible para los clientes y se borra al terminar.

**Cronometra `exportar.sh` y el rsync**: son el grueso del corte. Si los medios pesan tanto que tardan más de unos minutos, resuélvelo antes de la noche del corte, no durante.

Cuando termines, **quita las líneas del hosts** y deja la pila vacía:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down -v
```

---

## 4. El corte (guion con tiempos)

Un día antes: aviso a los clientes, imágenes construidas en el nuevo y un snapshot del VPS desde el hPanel de Hostinger, como seguro adicional.

| Minuto | Dónde | Qué |
|---|---|---|
| 0 | viejo | `docker compose --env-file .env.production -f docker-compose.prod.yml stop api web` — los clientes ven error, Meta empieza a reintentar los webhooks, y ya nada escribe en la base vieja |
| 1 | viejo | `bash ~/exportar.sh corte` (la base y los medios de hace un minuto) |
| 3 | viejo → nuevo | `rsync -avz corte/ usuario@IP-NUEVA:~/crm-prime/corte/` |
| 5 | nuevo | `bash deploy/migracion/importar.sh corte/` (con Redis esta vez) |
| 8 | nuevo | `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build` y mirar `logs -f api`: «Aplicando migraciones…» → «Iniciando servidor» |
| 9 | Cloudflare | registros A de `driony.com` y `*` → IP nueva, sin quitar el proxy. `www` es un CNAME que los sigue, y `api` y `admin` entran por `*`. Los AAAA, si existen, se cambian o se borran. No toques `gestor`. El modo SSL no puede ser *Flexible*: *Full*, *Full (strict)* o el automático en cualquiera de esos dos sirven. Si NPM va en el 8443, activa la Origin Rule justo después de cambiar los registros. Se aplica en segundos |
| 10 | tu PC | sin líneas en el hosts: `https://driony.com`, entrar en una empresa, bandeja en vivo, `https://admin.driony.com` |
| 12 | nuevo | `docker compose … logs api --since 5m \| grep -i webhook`: empiezan a llegar los webhooks que Meta reintentó; mandar un mensaje de prueba a un número conectado y verlo entrar |
| 15 | viejo | **no apagues ni borres nada**: la pila queda parada (`stop`, no `down -v`) una semana por si hay que volver |

Lo que puede fallar y qué significa:

- Error 521 o 522 de Cloudflare → el servidor nuevo no acepta conexiones en el 443: firewall del proveedor, `ufw`, o el proxy no está arriba.
- Error 525 o 526 de Cloudflare → el proxy host no tiene el certificado o no es válido.
- «Demasiadas redirecciones» → modo *Flexible* con *Force SSL*: pasa Cloudflare a *Full (strict)*.
- `network … declared as external, but could not be found` → `PROXY_NETWORK` no coincide con la red de NPM.
- La web carga pero todas las empresas ven la pantalla del dominio base → el proxy no pasa el `Host` intacto (en NPM es el comportamiento por defecto; en nginx, `proxy_set_header Host $host`).
- 502 en `api.driony.com` → `crm-api` no está en la red del proxy o aún está migrando; `docker compose ps`.
- La bandeja carga pero no «en vivo» → *Websockets Support* apagado en el proxy host de la API.
- Subir una imagen da 413 → falta `client_max_body_size 25m`.
- Las claves de IA salen como no configuradas → `.env.production` equivocado (ver §0).

---

## 5. Vuelta atrás

Solo tiene sentido en la primera hora: lo que entró al nuevo en ese rato no
vuelve al viejo.

1. Cloudflare: desactiva la Origin Rule si la activaste y pon los mismos registros → IP de Hostinger (segundos). Si cambiaste el modo SSL, devuélvelo.
2. Viejo: `docker compose --env-file .env.production -f docker-compose.prod.yml start api web`.
3. Nuevo: `stop api web` para que no haya dos plataformas vivas con el mismo número.

Nunca tengas **las dos** pilas arrancadas a la vez con el DNS a medias: las dos
atenderían seguimientos y difusiones y los clientes recibirían mensajes
duplicados.

---

## 6. Después del corte

- **Copias de seguridad** (hoy no hay): en el nuevo, un cron diario con `exportar.sh` y copia fuera del servidor. Por ejemplo, en `crontab -e`:
  ```
  30 3 * * * cd /root/crm-prime && bash deploy/migracion/exportar.sh /root/copias/$(date +\%F) > /root/copias/ultima.log 2>&1 && find /root/copias -maxdepth 1 -mtime +14 -type d -exec rm -rf {} +
  ```
  y `rclone sync /root/copias remoto:driony-copias` detrás, a un bucket o Drive. Una copia que vive en el mismo servidor no es una copia.
- Pasada una semana sin incidencias: da de baja el VPS de Hostinger, pero solo después de mover lo que siga ahí (n8n, su Nginx Proxy Manager y cualquier otro proyecto). Revoca sus claves SSH y quita de Cloudflare los registros que apuntaran a esa IP.
- Dos cosas que convenía hacer y la migración deja a tiro, pero **no el mismo día**: subir `WHATSAPP_GRAPH_VERSION` de `v21.0` a `v24.0` (lo que dicen los docs), y revisar si la aplicación se conecta a Postgres como `crm` (dueño de las tablas, con lo que RLS no aísla) o como `crm_app` (`docker compose exec api printenv DATABASE_URL | sed 's#//[^@]*@#//…@#'`); si es `crm`, activar el rol restringido es su propio cambio, con su propia ventana.

---

## Trampas conocidas

- **`JWT_ACCESS_SECRET` cifra las claves guardadas.** Ya está dicho dos veces; es la que más duele.
- **`NEXT_PUBLIC_*` se hornean en la imagen de la web** (`NEXT_PUBLIC_API_URL`, los IDs de WhatsApp): cualquier cambio exige `--build`.
- **Saltos de línea de Windows** en el `.env` hacen que las variables se lean mal; `importar.sh` lo comprueba.
- **El nombre de la carpeta es el nombre del proyecto Compose** y da el prefijo de los volúmenes; los scripts no dependen de él, pero si mezclas carpetas tendrás dos pilas.
- **Let's Encrypt limita** las emisiones (5 iguales por semana, 50 por dominio): emite el comodín una vez y guárdalo.
- **Meta reintenta** los webhooks que no pudo entregar durante el corte, pero no indefinidamente: cuanto más corto el corte, menos mensajes llegan tarde.
- **Hora del servidor en UTC** en los dos: los trabajos programados comparan con la hora del sistema.
