# Multi-tenant y modo enterprise

Diseño para que varias empresas usen la misma instalación, cada una bajo su
subdominio (`acme.driony.com`) y con su propia gestión de usuarios.

**Estado:** fases 1 y 2 completas (22/09/2026). El esquema es multi-inquilino,
las consultas se filtran solas y, con el rol restringido, la base rechaza lo
que se escape. 18 tests lo comprueban con dos empresas sembradas:

```
npm run test:tenancy --workspace=apps/api    # capa 1 — 8 tests
npm run test:rls     --workspace=apps/api    # capa 2 — 10 tests
```

La fase 3 está hecha: una empresa se da de alta sola y su subdominio responde
sin tocar DNS, certificados ni el proxy. 23 tests:

```
npm run test:tenancy --workspace=apps/api    # capa 1 — 8 tests
npm run test:rls     --workspace=apps/api    # capa 2 — 10 tests
npm run test:slug    --workspace=apps/api    # subdominios — 5 tests
```

**Decidido:**

- Un usuario pertenece a **una sola organización**. No hace falta tabla de
  pertenencias ni selector de organización: el modelo se simplifica bastante.
- Cada empresa tiene **su propio subdominio**.
- Los datos de cada empresa quedan **separados** entre sí (§1).
- La cancelación sigue el ciclo de tres estados de §8.

---

## 1. La decisión que condiciona todo

El subdominio es la parte fácil. Lo difícil es que **una sola consulta sin
filtrar filtra datos de una empresa a otra**, y eso, en un CRM, es un incidente
que se cuenta a los clientes.

Todo el diseño gira alrededor de hacer ese error imposible, no de confiar en
que nadie lo cometa.

### Estrategias de aislamiento

| | Cómo | Coste real |
|---|---|---|
| Base por empresa | Una BD por cliente | Aislamiento perfecto. Migrar 500 bases, 500 pools de conexión |
| Esquema por empresa | `CREATE SCHEMA acme` | Migraciones × N; Prisma no lo soporta bien |
| **Fila compartida + `orgId`** | Todo en las mismas tablas | Una migración, un pool. El riesgo es humano |

**Decisión: fila compartida con `orgId`.** Es lo que usa casi todo el SaaS
moderno y lo único operable con el equipo de una startup. El riesgo humano se
neutraliza con dos capas que se explican abajo.

Deja la puerta abierta a base dedicada para el cliente que pague por aislamiento
físico: como el `orgId` ya está en todas las filas, mover una empresa a su
propia base es un `pg_dump` filtrado, no un rediseño.

> **Separación lógica frente a física.** Con `orgId` + RLS ninguna empresa puede
> leer datos de otra: están separadas a todos los efectos funcionales y legales.
> Comparten servidor de base de datos, que es distinto de compartir datos. La
> separación *física* (una base por cliente) solo compensa cuando un contrato lo
> exige por escrito, y entonces se vende como extra.

### Las dos capas de defensa

**Capa 1 — Prisma Client Extension.** Inyecta `where: { orgId }` en toda
consulta a partir del contexto de la petición. Un desarrollador que olvide
filtrar sigue filtrando.

```ts
// Boceto. El orgId sale de AsyncLocalStorage, poblado por un interceptor.
prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query, model }) {
        const orgId = tenantContext.getStore()?.orgId;
        if (!orgId || !MODELOS_CON_ORG.has(model)) return query(args);
        args.where = { ...args.where, orgId };
        return query(args);
      },
    },
  },
});
```

**Capa 2 — Row-Level Security de Postgres.** Por debajo, la base rechaza filas
de otra organización aunque la consulta venga de un `$queryRaw` escrito a mano.

```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contacts
  USING ("orgId" = current_setting('app.current_org', true));
```

La aplicación fija `app.current_org` al principio de cada transacción. Es el
cinturón además de los tirantes: la capa 1 evita el error, la capa 2 evita el
desastre cuando la capa 1 falla.

> **Trampa conocida:** el usuario de la aplicación no puede ser el dueño de las
> tablas ni tener `BYPASSRLS`, o las políticas no se aplican. Hay que crear un
> rol aparte para la app.

---

## 2. Modelo de datos

```prisma
model Organization {
  id        String   @id @default(cuid())
  slug      String   @unique   // "acme" → acme.driony.com
  name      String
  plan      String   @default("enterprise")
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
}
```

### Qué tablas llevan `orgId`

**21 de los 36 modelos.** Trece son raíz de verdad:

`User` · `Tag` · `Product` · `Source` · `Pipeline` · `PipelineStage` · `WhatsappConnection` ·
`ApiKey` · `AiSetting` · `Template` · `KnowledgeDoc` · `CustomField` ·
`IntegrationSetting` · `WebhookSubscription`

**Cuatro más se desnormalizan a propósito** — `Contact`, `Conversation`,
`Message`, `Deal` — por dos motivos: son las tablas calientes y un índice
compuesto `(orgId, …)` cambia el plan de ejecución; y RLS necesita la columna en
la propia tabla para no hacer un `JOIN` en cada política.

**Y cuatro que el diseño en papel se dejó:** `AgentConfig` y `Flow` parecen
hijas de `WhatsappConnection`, pero esa relación es **opcional**: el bot de
respaldo y el flujo global tienen `channelId = null` y entonces no cuelgan de
nadie. `MetaPage` y `QuickReply` llegaron después, en la rama de Lead Ads y
plantillas, y aparecieron con el mismo problema.

Las cuatro son raíces encubiertas, y ninguna salió al diseñar: salieron al
compilar. Por eso la regla de abajo conviene pasarla cada vez que se añade un
modelo — es una consulta de treinta segundos y encuentra lo que la revisión a
ojo no.

> La regla que las encuentra: un modelo necesita `orgId` si **no tiene ninguna
> relación padre obligatoria**. Un padre opcional no sirve para heredar nada.

### Tres sitios que hoy asumen "solo hay uno"

Esto es lo que se rompe en silencio si no se mira:

| Dónde | Qué asume | Qué pasa a ser |
|---|---|---|
| [ai-settings.service.ts](apps/api/src/modules/ai/ai-settings.service.ts) | Fila única `id = "singleton"` | Una fila por organización |
| [integration-settings.service.ts](apps/api/src/modules/integrations/integration-settings.service.ts) | Ídem | Ídem |
| [bot.service.ts:95](apps/api/src/modules/ai/bot.service.ts#L95) | `isDefault: true` global | `isDefault` único **dentro** de la organización |

Los tres están resueltos. Las dos primeras eran, además, peores de lo que
parecía: cacheaban **una sola fila en memoria de proceso**, así que con dos
empresas la configuración de una se le habría servido a la otra. Ahora la caché
va por `orgId`.

La tercera se resuelve en la base, no en el código, con un índice único parcial
que Prisma no sabe expresar y va escrito a mano en la migración:

```sql
CREATE UNIQUE INDEX "agent_configs_one_default_per_org"
    ON "agent_configs"("orgId") WHERE "isDefault";
```

Comprobarlo desde la aplicación sería una carrera entre dos peticiones; en la
base es imposible por construcción.

### El cambio que rompe el login actual

```prisma
// Antes
email String @unique

// Después
@@unique([orgId, email])
```

Sin esto, la misma persona no puede trabajar en dos empresas. Con esto, el login
necesita saber **de qué organización** antes de buscar el usuario — y de ahí
viene la pantalla de acceso por subdominio.

---

## 3. Subdominio

### Infraestructura

```
*.driony.com   A   →   tu servidor
```

Certificado **wildcard** de Let's Encrypt por reto **DNS-01**. El HTTP-01 no
sirve para comodines: hay que poder escribir un registro TXT, así que el DNS
tiene que estar en un proveedor con API (Cloudflare, Route53).

Reserva subdominios desde el principio: `www`, `api`, `app`, `admin`, `docs`,
`mail`, `status`. Si alguien registra la empresa "api", te quedas sin API.

### Resolución en la web

El middleware de Next lee el `Host`, extrae el slug y lo pasa hacia abajo:

```ts
// apps/web/src/middleware.ts
export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const slug = host.split(".")[0];
  if (RESERVADOS.has(slug)) return NextResponse.next();

  const res = NextResponse.next();
  res.headers.set("x-org-slug", slug);
  return res;
}
```

### La regla que no se puede romper

**La API nunca toma el `orgId` del `Host`.** Lo toma del JWT, que va firmado:

```ts
export interface AccessTokenClaims {
  sub: string;   // userId
  sid: string;   // sessionId
  role: Role;
  orgId: string; // ← nuevo, firmado
}
```

Si el `orgId` viniera de una cabecera, cualquiera cambiaría `Host` con curl y
entraría en otra empresa. El subdominio sirve para **elegir a quién autenticarse
y qué marca mostrar**, nunca para autorizar.

El subdominio del token y el de la petición deben coincidir; si no, se rechaza.
Eso evita que una sesión de `acme` se use en la pestaña de `globex`.

---

## 4. Identidad por organización

### Lo básico

- **Invitaciones por correo** con token de un solo uso y caducidad
- **Roles dentro de la organización** (el `Role` actual pasa a ser por-org)
- **Usuario dueño** de la organización, que no se puede eliminar sin transferir

### SSO, que es lo que de verdad se paga

En el plan enterprise, la empresa quiere entrar con **su** Okta, su Entra ID o
su Google Workspace. Dos protocolos:

- **OIDC** — moderno, más simple. Google, Entra, Auth0
- **SAML 2.0** — el que exigen las empresas grandes y los departamentos de
  compras. Más feo, inevitable

La configuración es **por organización**: cada una registra su IdP, su
certificado y su mapeo de atributos. Conviene apoyarse en una librería (
`@node-saml/passport-saml`, `openid-client`) antes que implementar SAML a mano:
es un protocolo con muchas formas de hacerlo inseguro.

Añadidos habituales del plan: **SCIM** (que el IdP cree y borre usuarios solo),
**dominio verificado** (quien tenga correo `@acme.com` entra directo) y
**registro de auditoría**.

---

## 5. WhatsApp con varias empresas

Los números son **por organización**, y eso choca con algo: el webhook de Meta
es **la única entrada al sistema que no trae JWT**. Llega de fuera, sin sesión,
y hay que averiguar de qué empresa es antes de tocar una sola tabla.

### Resolver la organización

Meta manda todos los eventos a **una sola URL**, la de tu app, para todas las
WABA suscritas. Lo que distingue a una empresa de otra es
`value.metadata.phone_number_id`, y ese campo ya es la clave de tus canales:

```prisma
phoneNumberId String @unique   // ← se queda global a propósito
```

Tiene que seguir siendo único en toda la instalación: un número pertenece a una
empresa y solo a una. Si dos organizaciones pudieran reclamar el mismo número,
no habría forma de saber a quién entregar el mensaje.

El flujo queda así:

```
webhook de Meta
  └─ verificar firma                     (secreto de plataforma, ver abajo)
  └─ buscar WhatsappConnection por phoneNumberId   ← consulta SIN organización
  └─ de ahí sale el orgId
  └─ fijar el contexto de organización
  └─ a partir de aquí, todo filtrado con normalidad
```

Esa búsqueda es un **agujero deliberado** en la capa 1 de §1: se ejecuta antes
de saber la organización, así que no puede filtrarse. Conviene que la escapatoria
sea explícita y contada —algo como `prisma.$unscoped()`— para que salte a la
vista en una revisión y no se use por costumbre. Son cuatro o cinco sitios en
todo el sistema, y todos deberían estar en esta lista.

### El app secret cambia de dueño

Aquí los dos modos divergen de verdad:

| | Open source | Enterprise (SaaS) |
|---|---|---|
| App de Meta | Una por instalación, del propio negocio | **Una sola, tuya**, para todos los clientes |
| `WHATSAPP_APP_SECRET` | Del negocio, en Ajustes › Integraciones | **De la plataforma**, en el entorno |
| Verify token | Del negocio | De la plataforma |
| Cómo conecta el cliente | Pega token y Phone number ID a mano | **Embedded Signup**: autoriza y su WABA se suscribe a tu app |
| Keys de IA (OpenAI, Anthropic) | Del negocio: BD con respaldo en el `.env` | **De cada empresa**, en Ajustes › IA. Las del entorno son de la plataforma y no se prestan salvo `AI_SHARED_KEYS=true`, o con cupo por plan si `AI_INCLUDED=true` (IA de Driony, modelo fijo) |

Es decir: `IntegrationSetting.whatsappAppSecret` es por organización en modo
abierto, pero en SaaS el secreto es **uno solo, de la plataforma**, porque la
firma de todos los webhooks la calcula la misma app de Meta. El campo por
organización deja de usarse para WhatsApp (sigue valiendo para Voyage y la IA).

Eso también explica por qué el Embedded Signup existe: es lo que permite que el
cliente autorice tu app sin darte su token, y que su WABA quede suscrita a la
tuya. En SaaS deja de ser un lujo y pasa a ser el camino principal.

**La app propia del cliente, como camino alternativo.** El Embedded Signup
solo incorpora clientes cuando Meta ha dado a la plataforma *acceso avanzado*
a `whatsapp_business_management` y `whatsapp_business_messaging` (revisión de
app + verificación de negocio); hasta entonces, a cualquiera sin rol en la app
le sale el error `#2655111`. Para no depender de ese plazo —y para quien
prefiera su propia app— el campo por organización sigue vivo con otro
significado: es la app **propia** de esa empresa. Guarda su App ID, App secret
y verify token en Ajustes › Integraciones, apunta el webhook de su app a
`acme.driony.com/api/v1/webhooks/whatsapp` (`OrgWebhookController`) y añade el
número a mano con un token permanente. El subdominio elige la empresa; la
firma con **su** secreto autentica (sin secreto no entra nada: la ruta es
pública); y el worker exige que el número del evento sea de esa empresa
(`InboundOrigin.orgId`), porque una app ajena que firme bien lo suyo no puede
meter mensajes en otra. El webhook de la plataforma sigue en
`whatsapp/webhook`, con el secreto del entorno.

### Las colas también necesitan la organización

**Estado (24/09/2026): hecho, y con una lección.** Al revisar "¿cada empresa
usa solo sus números?" apareció que **cinco de los seis workers** no abrían
contexto: envíos, campañas, flujos, leads de Meta y webhooks salientes. Con una
empresa nadie lo nota, porque la organización única hace de respaldo; con dos,
la extensión de Prisma les lanza "sin organización en contexto" y todo lo que
pasa por cola deja de funcionar. Era invisible hasta el primer cliente de
verdad.

La regla quedó en un solo sitio, `runJobInOrg()` en
[job-org.ts](apps/api/src/infra/tenant/job-org.ts): la empresa viaja en el
trabajo (la pone quien encola, que sí tiene contexto) o se deduce del dato que
el trabajo señala — el mensaje, la conversación, la plantilla de la campaña, la
página de Meta —, siempre con `runUnscoped` porque es la consulta que produce
el filtro. Si no hay forma de saberla, en SaaS el trabajo **falla** con motivo.

| Worker | De dónde sale la empresa |
|---|---|
| Entrante (WhatsApp) | `phone_number_id` → `WhatsappConnection.orgId`; para `template_status`, `wabaId` |
| Envío | `orgId` en el job; si falta, `Message.orgId` |
| Flujos | `orgId` en el job; si falta, `Conversation.orgId` |
| Campañas | `orgId` en el job; si falta, `Campaign.template.orgId` |
| Leads de Meta | `MetaPage.orgId` por `pageId` (el aviso viene de Meta, sin contexto) |
| Webhooks salientes | `orgId` en el job; si falta, `WebhookSubscription.orgId` |

Dos consecuencias del mismo repaso:

- **El tiempo real tenía una sola sala para todos.** Cada cambio de bandeja de
  una empresa llegaba a los navegadores de las demás: no el contenido, pero sí
  los ids y el ritmo de actividad. Ahora hay una sala por empresa, `org:<id>`,
  y la sala la decide el `org` firmado en el token, no el cliente. Un evento
  sin empresa en SaaS se descarta, no se emite "por si acaso".
- **Nada de credenciales del `.env` para los clientes.** En SaaS el
  `WHATSAPP_TOKEN` del entorno es de la plataforma; una empresa sin número
  propio ya no puede enviar con él. Y conectar un número que otra empresa ya
  conectó devuelve un 409 claro en vez de un 500.

El contexto de organización viaja con la petición HTTP. **Los workers no tienen
petición.** Todo job encolado —mensaje saliente, campaña, reanudación de flujo,
webhook saliente— tiene que llevar el `orgId` en su carga y fijar el contexto al
empezar a procesarse.

Es fácil olvidarlo y el síntoma es feo: el worker corre sin contexto, la
extensión de Prisma no filtra y una campaña se envía a los contactos de otra
empresa. Merece una comprobación explícita: si un job entra sin `orgId`, que
falle en vez de continuar.

---

## 6. Núcleo abierto y capa enterprise

**Los dos modos conviven, no se sustituyen:**

| | Open source (AGPL) | Enterprise (tu SaaS) |
|---|---|---|
| Quién lo despliega | El propio negocio, en su servidor | Tú, una sola instalación |
| Organizaciones | **Una** | Muchas |
| Acceso | `crm.sunegocio.com`, su dominio | `acme.driony.com` |
| Usuarios | Los suyos, en su base | Los suyos, aislados por `orgId` |
| App de Meta | La suya | La tuya (§5) |

### Un solo esquema, no dos

La tentación es hacer que el núcleo no sepa nada de organizaciones y que
enterprise las añada. **Es un error**: dos esquemas divergentes se vuelven
inmantenibles a la tercera migración.

Lo que se hace: `orgId` existe **siempre**, también en open source, donde
simplemente hay una única organización que crea el `seed`. El núcleo no nota la
diferencia —su contexto de organización devuelve siempre la misma— y quien se
autoaloja ni se entera de que la columna está ahí.

Lo que añade el paquete enterprise es la capa que la hace *real*: resolución por
subdominio, gestión de organizaciones, SSO, facturación y el panel de
administración global. El aislamiento (extensión de Prisma y RLS) va en el
núcleo, porque es una defensa y las defensas no se venden aparte.

### Dónde vive cada cosa

El CRM está bajo **AGPL-3.0**. Si el multi-tenant, el SSO y la facturación van
en el núcleo, cualquiera monta tu mismo SaaS con tu código. Lo que hacen GitLab,
Sentry o Chatwoot:

```
apps/api/src/modules/      AGPL · el CRM completo, monoinquilino
apps/api/src/enterprise/   licencia propia · tenancy, SSO, facturación
```

Dos reglas para que esto funcione:

1. **El núcleo tiene que funcionar solo y completo.** Si le falta algo esencial,
   el open source es un cebo y la comunidad lo nota. El CRM monoinquilino ya es
   un producto entero: eso es lo que hay que preservar.
2. **La dependencia va en un solo sentido.** El paquete enterprise importa del
   núcleo; el núcleo no sabe que existe. Se engancha por los puntos de extensión
   que ya usa el proyecto (módulos de Nest, el patrón adaptador).

La tenencia encaja bien en ese molde: la extensión de Prisma y el interceptor
que puebla el contexto son un módulo que se monta o no se monta.

> Tú eres el dueño del copyright, así que además puedes vender licencias
> comerciales a quien no quiera las obligaciones de la AGPL. Eso es
> independiente de este reparto.

---

## 7. Migración por fases

El objetivo es no romper nada en ningún momento. La instalación actual se
convierte en la organización número uno.

**Fase 1 · Modelo y contexto. ✅ Hecha.** Modelo `Organization`, `orgId` en las
19 tablas raíz, migración escrita a mano (añadir NULL → rellenar → `SET NOT
NULL`, porque ya había datos) y `TenantService` como único sitio que responde
"¿de qué organización es esto?". La app funciona exactamente igual: una sola
organización, creada por el seed.

Lo que hizo que la fase saliera bien fue **no** inyectar el `orgId` por magia.
Al dejar la columna obligatoria y sin extensión de Prisma que la rellene, el
compilador señaló los 68 sitios que escribían sin dueño, uno por uno. Una
extensión que lo inyectara habría hecho la fase más corta y habría dejado el
error posible: el día que el contexto falte, la fila se escribe igual.

Tres sitios no usan el contexto sino el **dato**, que es más fiable:

| Camino | De dónde sale el `orgId` | Por qué |
|---|---|---|
| Webhook de WhatsApp | `phone_number_id` → `WhatsappConnection.orgId` | Meta no manda JWT; el número es lo único que identifica a la empresa |
| Cola de campañas | `Contact.orgId` | Un worker no tiene petición HTTP detrás |
| Envío saliente | `Conversation.orgId` | Si el contexto estuviera mal, el mensaje caería donde debe igual |

**Fase 2 · Aislamiento. 🟡 Capa 1 hecha, falta RLS.**

Hecho: la extensión de Prisma inyecta `where: { orgId }` en las 13 operaciones
de lectura y filtrado, el `orgId` viaja firmado en el JWT, y el contexto se
puebla en cada petición. Ocho tests con dos empresas comprueban lo que importa,
que son las negativas: que un id adivinado devuelva `null`, que un `deleteMany`
no cruce la línea, que sin contexto la consulta **rompa** en vez de devolverlo
todo.

Dos detalles de implementación que costaron y conviene no volver a descubrir:

- **El contexto va en middleware + interceptor, no solo en interceptor.**
  `AsyncLocalStorage.run()` desde un interceptor envuelve la *creación* del
  Observable, no su ejecución: para cuando corre el handler, el contexto se
  perdió. El middleware abre el contenedor vacío (ahí sí envuelve la petición
  entera) y el interceptor lo rellena, ya con los guardias ejecutados.
- **Las escrituras no se tocan.** `create` y `createMany` quedan fuera de la
  extensión a propósito: con `orgId` obligatorio en el esquema, el compilador
  obliga a ponerlo. Inyectarlo aquí lo volvería opcional, y el día que faltara
  el contexto la fila se escribiría igual.

Los cuatro agujeros deliberados están marcados con `runUnscoped("motivo", …)`,
que es una función con nombre feo justamente para que salte a la vista en una
revisión: login por correo, alta de usuario, webhook por `phone_number_id` y
clave de API por prefijo. Los cuatro tienen el mismo motivo: producen el
`orgId`, así que no pueden filtrar por él.

### Capa 2 · Row-Level Security

Hecho. 20 tablas con políticas, y el test que las justifica es el del RAG: la
búsqueda vectorial es un `JOIN` en SQL crudo sin filtro de empresa, exactamente
lo que la capa 1 no puede tocar. Sin RLS, el agente de una empresa recuperaría
los documentos internos de otra y los citaría a un cliente.

**Se despliega sin riesgo y se activa aparte.** En Postgres el dueño de una
tabla se salta sus propias políticas, y la aplicación se conecta hoy como
dueña: después de la migración no cambia nada. Las políticas despiertan el día
que el `DATABASE_URL` apunte al rol restringido
([scripts/create-app-role.sql](scripts/create-app-role.sql)). Separar "desplegar
el código" de "activar la defensa" evita juntar dos riesgos la misma noche.

Es también la trampa de §1 hecha real: si te conectas con el dueño, las
políticas existen, se ven en el catálogo y **no protegen nada**. Por eso el
primer test comprueba el rol antes que ninguna otra cosa.

**Falla cerrado.** `current_setting('app.current_org', true)` devuelve NULL si
nadie la fijó, y `"orgId" = NULL` no es cierto para ninguna fila: una consulta
que se olvide devuelve cero filas, no todas.

**Qué protege y qué no.** Protege contra el error humano y contra una inyección
SQL corriente, que se queda dentro del `WHERE` y no puede saltarse la política.
No protege contra quien ya controle el proceso de la aplicación: ese puede
ejecutar `SET app.current_org` y ponerse donde quiera.

### Tres cosas que costaron

Las tres se descubrieron probando, no razonando, y las tres tienen test propio:

**1. Dentro de una transacción interactiva, la consulta de la extensión corre en
otra conexión.** Por eso el `set_config` hay que mandarlo en la forma por lotes,
`$transaction([setConfig, query(args)])`, y no envolviendo con
`$transaction(async tx => …)`. Con la forma interactiva la consulta devuelve
cero filas y parece un problema de permisos.

**2. Envolver cada operación rompe la atomicidad.** Un `$transaction([a, b])` de
la aplicación acababa siendo **dos** transacciones, una por operación. Todo
funciona hasta que `b` falla y `a` ya está aplicada. Lo rompía, entre otras
cosas, la revocación de sesiones: se marcaba la sesión y no sus tokens. La
solución es interceptar `$transaction` y marcar las operaciones de dentro para
que no lo repitan.

**3. Las promesas de Prisma son perezosas, y eso muerde a AsyncLocalStorage.**
`runUnscoped(() => prisma.user.findUnique(…))` creaba la promesa dentro del
contexto y la ejecutaba fuera, al hacer `await`. Resultado: la escapatoria no
se aplicaba y, con RLS activo, **nadie podía iniciar sesión**. `runInOrg` y
`runUnscoped` son `async` y esperan a `fn()` por dentro justamente por esto.

### Lo que cuesta

Cada consulta pasa a ser una transacción de dos sentencias. Medido en local,
contra la misma base y el mismo rol: **1,2 ms → 3,6 ms por consulta**. Es el
peor caso (latencia de red casi cero hace que el coste fijo pese más).

Por eso `DB_RLS` se activa solo con `TENANCY_MODE=multi`: en una instalación de
una sola empresa no aísla de nadie y sí cuesta el triple.

**Fase 3 · Subdominio. ✅ Hecha.** `@@unique([orgId, email])`, middleware de
Next que traduce `Host` → slug, acceso por empresa, alta transaccional y lista
de subdominios reservados. Ver §10.

**Fase 4 · Enterprise.** SSO por organización, invitaciones, panel de
administración global, facturación por plan.

Las fases 1 y 2 son el grueso y el riesgo. La 3 es infraestructura. La 4 es
producto y se puede vender antes de estar completa.

---

## 8. Cancelar una organización

Cancelar **no** es borrar. Tres estados, y el del medio existe porque la mitad
de las cancelaciones son errores, tarjetas caducadas o cambios de opinión:

| Estado | Cuándo | Qué pasa |
|---|---|---|
| `canceled` | Día 0 | Se corta el acceso **y todo lo automático** |
| `grace` | 30–60 días | Datos intactos, reactivable, exportación disponible |
| `purged` | Tras la gracia | Borrado real e irreversible |

### Lo que sigue corriendo si solo bloqueas el login

Esta es la parte que se olvida, y aquí es grave porque **el CRM actúa solo**.
Una organización cancelada sin apagar sigue:

- **Respondiendo con el autopilot**, gastando *tu* presupuesto de OpenAI
- **Recibiendo webhooks de Meta**, porque su WABA sigue suscrita a tu app
- **Aceptando escrituras por sus claves de API** — su n8n no se ha enterado
- **Disparando sus webhooks salientes** hacia sus sistemas
- **Enviando campañas programadas**, que son mensajes facturables

Cancelar tiene que ser una operación que **apaga cosas**, en este orden:

```
1. Revocar todas las ApiKey de la organización
2. Desactivar sus WebhookSubscription
3. Poner sus AgentConfig en isActive=false y las conversaciones en aiMode=OFF
4. Cancelar los jobs en cola (campañas, flujos con delay, envíos)
5. Desuscribir la WABA de la app de Meta y desactivar sus canales
6. Bloquear el login
```

Los pasos 1–5 son los que de verdad detienen el gasto. El 6 es el que se ve.

### Exportar

Disponible durante toda la gracia, y obligatorio ofrecerlo antes de purgar:
contactos con campos y etiquetas, conversaciones con sus mensajes,
oportunidades, productos y base de conocimiento. CSV para lo tabular, JSON para
lo anidado.

> Hoy **no existe ninguna exportación** en el CRM. Hay que construirla, y es
> requisito para poder purgar con tranquilidad.

### Destruir de inmediato, sin esperar a la gracia

Las credenciales que les custodias cifradas: su clave de OpenAI o Anthropic, la
de Voyage, el token de WhatsApp de cada canal y los secretos de sus webhooks.
Son suyas; no hay razón para guardarlas un día más del necesario, y sí riesgo si
te las roban.

### Lo que NO se borra

Facturación e importes. Hay obligación mercantil de conservarlos varios años y
son registros tuyos, no del cliente. Van en tablas sin `orgId` en cascada, o con
`onDelete: SetNull`, para que purgar la organización no se los lleve por delante.

### Purgar

El esquema ya tiene **21 borrados en cascada**, así que la mayor parte cae sola
al eliminar la organización. Lo que hay que revisar a mano son las relaciones
con `SetNull` y el almacenamiento de ficheros (`apps/api/storage/`), que vive
fuera de la base y no se entera de ningún `DELETE`.

### Lo legal

Con clientes en la UE eres **encargado del tratamiento** y el contrato (DPA)
fija el plazo de borrado tras la terminación — 30 o 90 días es lo habitual.
Diseñar esto junto al modelo y no después evita descubrir que no puedes borrar
sin romper integridad referencial.

---

## 10. Alta de empresas con subdominio

### Lo que NO hay que automatizar

La tentación es llamar a la API del DNS y a la del proxy en cada alta. Es peor
en todo:

- **Let's Encrypt emite 50 certificados por dominio registrado cada 7 días.** A
  la empresa 51 de la semana el alta falla y solo cabe esperar. Es un techo
  duro.
- Emitir tarda de segundos a minutos: o el usuario espera, o se registra y su
  subdominio "todavía no va".
- La API de Nginx Proxy Manager no tiene contrato público.
- Y el fallo a mitad —fila creada, DNS sí, certificado no— obliga a escribir
  lógica de compensación para un problema que no existía.

**Con comodín no hay nada que automatizar.** Un registro DNS `*.driony.com`,
un certificado comodín por reto DNS-01 (HTTP-01 no puede emitirlos) y **un solo
proxy host** `*.driony.com → crm-web:3000`. A partir de ahí, dar de alta una
empresa es insertar una fila.

Esa fila se inserta **acotada a la empresa que se está creando**, no con la
escapatoria. La petición entra por el dominio raíz, sin empresa en contexto, y
una transacción sin contexto no fija `app.current_org`: con el rol restringido
de producción, RLS rechaza la primera fila con dueño (`users`) y el alta muere
con un 500 que en desarrollo no aparece, porque ahí el usuario de la base es
dueño de las tablas y se salta las políticas. Por eso `OrganizationService.register`
decide el `orgId` antes de abrir la transacción y la envuelve en
`runInOrg(orgId, …)`: todo lo que escribe lleva ese dueño y las políticas lo
aceptan. `test/rls.test.ts` cubre el caso con el rol restringido.

El precio del comodín es que la renovación es un punto único de fallo: si
caduca el token del DNS, caen todas las empresas a la vez. Conviene vigilar el
vencimiento.

El comodín cubre **un solo nivel**: `acme.driony.com` sí, `a.b.driony.com` no.
Por eso el middleware rechaza los slugs con punto.

### El dominio raíz no inicia sesión

`driony.com/login` pregunta **cuál es tu empresa** y salta a
`acme.driony.com/login`, que es donde está el formulario de verdad. Igual que
Slack con el workspace. No es estética: en SaaS el correo no identifica a nadie
por sí solo —puede existir en dos empresas—, así que un login "sin empresa"
sería una búsqueda a ver a quién encuentra. La API lo rechaza con 400 en modo
multi, y el middleware manda a su subdominio a quien llegue al raíz con sesión
(un marcador viejo, una sesión anterior al cambio). Para eso el login devuelve
`orgSlug` y la web lo guarda en la sesión.

### El SDK de Meta corre en un solo host

Meta solo deja que su SDK de JavaScript arranque en dominios **listados a mano**
en el panel de la app — "el dominio de la página que aloja el SDK debe
coincidir con una de las entradas", sin comodines. Con un subdominio por
empresa, eso obligaría a tocar Meta en cada alta: justo lo que el comodín
evitaba en DNS, de vuelta por otra puerta.

Así que el SDK carga en un solo sitio, `driony.com/connect/whatsapp`, listado
una vez. El usuario no lo nota: el panel de la empresa lo enseña **en un modal,
dentro de un iframe** servido desde el dominio raíz. Meta mira el dominio del
marco que llama a `FB.login`, no el de la página que lo contiene, así que desde
`acme.driony.com` se abre la ventana de Meta sin salir de ahí — lo mismo que
se ve en Kommo. El middleware pone `Content-Security-Policy: frame-ancestors`
en `/connect/…` para que solo los subdominios de la plataforma puedan
enmarcarlo.

Lo que cruza desde el panel de la empresa hasta el conector es un **pase
firmado de un solo uso** (`OneTimeTicketService`: quién, de qué empresa, para
qué, 15 minutos). Al terminar el Embedded Signup, el conector entrega el pase y
el resultado de Meta a la API, que abre el contexto de esa empresa y guarda el
número; después avisa al panel por `postMessage` (solo a su origen), que
refresca la lista y cierra el modal. Abierto como página suelta, devuelve al
usuario a `acme.driony.com/whatsapp`. Es el patrón de Shopify o Slack: el OAuth
ocurre en un dominio central y después se entrega.

En Meta, entonces, solo hace falta `driony.com` en *App Domains* y en *Allowed
Domains for the JavaScript SDK*. Y el día que se vendan dominios propios
(`crm.acme.com`) el conector sigue valiendo igual.

Con una sola empresa (open source) no hay conector: el SDK carga en la propia
página como siempre, y `POST whatsapp/connect/ticket` devuelve
`connectUrl: null`. Pendiente: el conector de páginas de Facebook para Lead Ads
sigue cargando el SDK en el panel; usa el mismo mecanismo y se moverá igual.

### La API también bajo el subdominio de cada empresa

Al estilo Kommo: `acme.driony.com/api/public/v1/contacts`. Es la misma API y
la misma clave; lo que se añade es una comprobación de **coherencia**: si la
llamada entra por la dirección de una empresa, la clave tiene que ser de esa
empresa (403 si no). No concede nada —la clave ya lo hizo—, evita usar una
clave contra la dirección equivocada. En el proxy es una ubicación más en el
host comodín: `/api/public/` y `/api/v1/webhooks/` → API; el resto → web.
`api.driony.com` se queda para lo que necesita una URL fija: el webhook de
Meta y el WebSocket.

### El subdominio no da acceso

`Host` lo controla quien llama: `curl -H "Host: otra.driony.com"` dice lo que
quiera. Así que el subdominio hace **una sola cosa**: elegir a quién buscar en
la pantalla de acceso. El `orgId` del token sale de la fila del usuario, y toda
consulta se filtra por el token, nunca por el `Host`.

Comprobado de extremo a extremo: el mismo correo en dos empresas entra en una u
otra según el subdominio, y la contraseña de una devuelve 401 en la otra.

### El alta es una transacción

Organización, primer administrador, seis etapas y el bot por defecto, todo o
nada. Una empresa a medias es peor que un alta fallida: el usuario no puede
entrar, no puede reintentar porque el slug ya está cogido, y hay que arreglarlo
a mano.

Dos altas simultáneas con el mismo slug las resuelve el índice único de la
base (`P2002` → 409), no la comprobación previa, que solo existe para dar un
error entendible.

### El alta va en dos pasos, y al terminar ya estás dentro

El formulario pregunta primero por la empresa (nombre y subdominio) y solo
después por la cuenta. No es estética: el subdominio necesita ida y vuelta al
servidor para saber si está libre, y resolverlo antes de pedir nada más evita
el caso peor — rellenar cinco campos y descubrir al final que el nombre estaba
cogido. Cada paso valida con un recorte del **mismo** esquema Zod que usa el
servidor (`signupCompanyStepSchema`, `signupAccountStepSchema`), así que los
mensajes son idénticos y no hay dos verdades. Si el servidor rechaza un campo
del paso 1 (el subdominio se lo llevó alguien mientras rellenabas la cuenta),
el formulario vuelve a ese paso con el campo marcado.

**Entrar sin volver a escribir la contraseña.** La sesión es una cookie de
`acme.driony.com`, y el alta ocurre en `driony.com`: desde ahí no se puede
dejar al usuario dentro. Lo que cruza el dominio es un **pase** — un JWT con
`purpose: "handoff"`, dos minutos de vida y `jti` de un solo uso — que el alta
devuelve y que `acme.driony.com/handoff?token=…` canjea por una sesión real.
Viaja en la URL, así que acaba en el historial y quizá en un log; por eso no
sirve dos veces ni dura más que un redirect. Repetirlo lleva al acceso normal
con un aviso, nunca a un error en blanco.

Los `jti` canjeados se guardan en memoria del proceso, igual que el límite de
intentos de login. Con varias instancias detrás del proxy, cada una lleva su
lista: un pase podría canjearse una vez por instancia dentro de los dos
minutos. Es el mismo compromiso que ya existía y se resuelve igual — Redis,
que está en la pila — el día que haya más de una instancia.

**Límite de altas: 5 por IP y hora.** Suficiente contra un script tonto, y
con la misma limitación por instancia de arriba. Lo que **no** está todavía
es la verificación de correo antes de crear la empresa: hoy cualquiera ocupa
un subdominio con un correo inventado. Es lo siguiente, junto con las
invitaciones.

### Dominios propios del cliente

`crm.acme.com` **no** lo cubre el comodín. Ese caso necesita emisión automática
por dominio: Caddy con *on-demand TLS* y un endpoint `ask` que pregunte a la API
si ese host está dado de alta antes de pedir el certificado. No está hecho, y no
conviene montarlo hasta venderlo: complica el despliegue por una función que
todavía no existe.

---

## 9. Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| ¿Un usuario en varias organizaciones? | **No.** Una sola. Sin tabla de pertenencias |
| ¿Cómo entra cada empresa? | **Subdominio propio** bajo tu dominio |
| ¿Qué separación? | **Lógica**, con `orgId` + RLS (§1) |
| ¿Los números de WhatsApp? | **Por organización** (§5) |
| ¿Qué pasa al cancelar? | Tres estados, y apagar antes que bloquear (§8) |
| ¿El open source? | **Se queda**, monoinquilino y completo (§6) |

### Lo único que sigue abierto

**¿Dominio propio del cliente** (`crm.acme.com` apuntando a ti) además del
subdominio? Es una petición habitual en enterprise y cambia la gestión de
certificados: pasas de un comodín a emitir uno por cliente bajo demanda, con
verificación de dominio. No bloquea nada: se puede añadir después sin tocar el
modelo de datos.
