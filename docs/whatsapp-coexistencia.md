# WhatsApp Coexistencia · Estado

Estado al **2026-09-30**. Objetivo: conectar el número con **coexistencia**
(seguir usando WhatsApp Business en el celular y, a la vez, gestionarlo desde
Driony).

---

## Resumen

| Pieza | Estado |
|---|---|
| Embedded Signup **v4** en el código (conector y pantalla de WhatsApp) | ✅ Hecho 2026-09-30 |
| Conexión por coexistencia sin `phone_number_id` (Meta solo manda la WABA) | ✅ Hecho 2026-09-30 |
| Aviso a las empresas mientras Meta no apruebe a la plataforma | 🗑️ Retirado 2026-10-31: Meta aprobó la plataforma; ya no hay aviso ni `WHATSAPP_TECH_PROVIDER_APPROVED` |
| Configuración **v4** de Facebook Login for Business en la app de Meta | ⬜ Pendiente (manual, en el panel de Meta) |
| Aprobación de Meta: verificación del negocio + acceso avanzado (Tech Provider) | ✅ Aprobada (avisado 2026-10-31) |
| Prueba real de coexistencia contra Meta | ⬜ Pendiente: ya se puede hacer |

> Lo del código está probado con typecheck, pruebas sin Meta (elección del
> número en la WABA, aviso de aprobación) y el conector en el navegador con un
> SDK simulado. **No está probado contra Meta real**: eso exige la aprobación.

---

## Requisito de Meta (sigue siendo el bloqueo)

La opción *"conectar tu app de WhatsApp Business existente"* **solo aparece si
el negocio dueño de la app de Meta es Tech Provider o Solution Partner** con
acceso avanzado. Si no, Meta muestra la pantalla normal de la API.

> ⚠️ Si al probar aparece *"Agrega tu número de teléfono · Ingresar un nuevo
> número"*, **no completes esa pantalla**: registrar el número por ahí lo migra
> a la Cloud API y deja de funcionar en la app WhatsApp Business del celular.

- [ ] Verificar el negocio: Meta Business Suite → Configuración → Centro de
      seguridad → Verificación del negocio.
- [ ] Revisión de la app con acceso avanzado a `whatsapp_business_management`
      y `whatsapp_business_messaging` (grabación de pantalla del flujo completo,
      en inglés o con subtítulos).
- [ ] Asistente de **Tech Provider** en la sección WhatsApp de la app.
- [ ] Número en **WhatsApp Business app 2.24.17 o superior**.

Meta aprobó la plataforma (avisado el 2026-10-31). El aviso «Conexión con un
clic: en revisión por Meta», su botón «Soy del equipo de la plataforma» y la
variable `WHATSAPP_TECH_PROVIDER_APPROVED` se retiraron: todas las empresas
ven directamente «Conectar WhatsApp». Si la variable sigue en el `.env` del
servidor, ya no hace nada y se puede borrar.

---

## Embedded Signup v4 (hecho en código, falta la configuración en Meta)

Meta retira la **v2 el 15 de octubre de 2026** (la v3 también). En v4 los
productos se eligen en la **configuración de Facebook Login for Business**, no
en el código: `extras` va con `setup: {}` y, para coexistencia, el selector
`featureType: "whatsapp_business_app_onboarding"` (sigue haciendo falta para
que aparezca esa rama). Ya no se manda `sessionInfoVersion`.

Lo que hay que hacer en el panel de Meta (una sola vez):

- [ ] *Facebook Login for Business → Configurations* → **crear una configuración
      nueva** (al elegir productos queda en v4). Marcar WhatsApp (Cloud API) y
      la opción de **WhatsApp Business App onboarding** (coexistencia).
- [ ] Copiar su **Config ID** a `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` y reconstruir
      el frontend (`--build web`): las `NEXT_PUBLIC_*` van dentro de la imagen.
- [ ] Graph API: el código usa **v24.0** por defecto (disponible hasta febrero
      de 2028). Si `.env.production` fija `WHATSAPP_GRAPH_VERSION=v21.0`,
      subirlo a `v24.0` (v21.0 deja de estar disponible en enero de 2027).

Eventos que llegan por `postMessage` (`WA_EMBEDDED_SIGNUP`): `FINISH` (con
`phone_number_id` y `waba_id`), `FINISH_ONLY_WABA` (sin número),
`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (coexistencia: **solo `waba_id`**) y
`CANCEL` (con `current_step`, o con `error_message` + `error_code`).

---

## Qué hace ahora el código al conectar

`apps/api/src/modules/whatsapp/whatsapp-connection.service.ts` → `connect()`:

1. Canjea el `code` por un token.
2. Si no llegó `phone_number_id` (coexistencia), lee
   `GET /{waba_id}/phone_numbers?fields=id,display_phone_number,is_on_biz_app,platform_type`
   y elige el número: con uno, ese; con varios y coexistencia, el último que
   está en la app del celular; si no, el primero (`pickPhoneNumber`).
3. Comprueba el plan (número nuevo, coexistencia).
4. Si se pidió coexistencia, consulta `GET /{phone_number_id}?fields=is_on_biz_app,platform_type`.
   Si Meta dice que el número **no** está en la app del celular, lo guarda en
   **modo API** y lo registra en el log: el panel no promete lo que no hay.
5. Guarda el canal, suscribe la app a la WABA (`POST /{waba_id}/subscribed_apps`;
   si falla, el canal queda en error con el motivo) y, solo en coexistencia,
   pide contactos e historial (`POST /{phone_number_id}/smb_app_data` con
   `smb_app_state_sync` y `history`). Meta exige esto **en las 24 h**
   siguientes a conectar; si no, hay que desconectar y repetir.

El conector (`apps/web/src/app/connect/whatsapp/ConnectWhatsappHub.tsx`)
entiende `CANCEL`: muestra el motivo de Meta y, si es el #2655111 o habla de
permisos avanzados (no debería pasar ya), pide reintentar y avisar.

---

## Configuración de Meta (checklist completo)

App de tipo **Business** con los productos **WhatsApp** y
**Facebook Login for Business**.

- [ ] *App settings → Basic*: App ID, App Secret, App Domains `driony.com` y
      URL de política de privacidad `https://driony.com/privacy`.
- [ ] *Facebook Login for Business → Settings*: *Login with the JavaScript SDK*
      activado, *Allowed Domains* `https://driony.com`.
- [ ] *Facebook Login for Business → Configurations*: configuración **v4** (ver
      arriba); copiar el **Config ID**.
- [ ] *WhatsApp → Configuration → Webhook*:
  - Callback URL: `https://api.driony.com/api/v1/whatsapp/webhook`
  - Verify token: el mismo que `WHATSAPP_VERIFY_TOKEN`
  - Campos: `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`

---

## Variables en el VPS (`.env.production`)

```env
WHATSAPP_APP_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_GRAPH_VERSION=v24.0
NEXT_PUBLIC_WHATSAPP_APP_ID=            # mismo valor que WHATSAPP_APP_ID
NEXT_PUBLIC_WHATSAPP_CONFIG_ID=         # el de la configuración v4
```

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build api web
docker exec crm-api printenv WHATSAPP_TECH_PROVIDER_APPROVED
docker logs crm-api 2>&1 | grep -i whatsapp | tail -20
```

> En el VPS usa siempre `-f docker-compose.prod.yml`. `docker-compose.yml` es
> solo de desarrollo y publica Postgres y Redis a internet.

---

## Después de conectar (a tener en cuenta)

- Los mensajes llegan al celular y a Driony; lo enviado desde el celular también
  aparece en Driony (`smb_message_echoes`).
- Abrir WhatsApp Business en el celular con regularidad: Meta desconecta la
  coexistencia si la app pasa mucho tiempo sin usarse.
- Rendimiento fijo de 20 mensajes/segundo en coexistencia.
- Lo enviado desde Driony paga la tarifa de la API; fuera de la ventana de
  24 h hay que usar plantillas.

---

## Fuentes (consultadas el 2026-09-30)

- Implementación de Embedded Signup (v4): https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
- Versiones (v2/v3/v4) y retirada de la v2: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/
- Onboarding de usuarios de WhatsApp Business App (coexistencia): https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- Errores del Embedded Signup: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors/
- Versiones de la Graph API: https://developers.facebook.com/docs/graph-api/changelog/
