# Modelo de suscripciones, IA administrada y BYOK: auditoría y plan

Entrega inicial que pide `DRIONY_MODELO_SUSCRIPCIONES_BYOK_HANDOFF.md`
(04‑11‑2026) antes de tocar código: inventario con rutas, matriz de lo que hay
frente a lo que se pide, riesgos, diseño mínimo, plan P0/P1/P2, pruebas y
preguntas bloqueantes. **No se ha modificado código, precios, límites, claves ni
producción.** Todo lo que sigue se verificó en el repositorio el 04‑11‑2026.

## 1. Resumen ejecutivo

La decisión comercial del documento (precios actuales, BYOK sin recargo en
planes de pago, IA administrada como alternativa dentro del mismo plan,
implementaciones aparte) **ya está construida en lo esencial**:

- Los cuatro planes y sus cupos de IA (100 / 500 / 2.000 / 6.000) viven en
  código, en `packages/shared/src/plans.ts`, y coinciden con la web, la página de
  precios y la documentación de planes.
- La IA administrada existe («IA de Driony», `AI_INCLUDED=true`): clave de
  OpenAI de la plataforma, modelo fijo, cupo de conversaciones por plan, tope en
  dólares, paquetes extra prepagados y traspaso al equipo cuando se agota.
- BYOK existe en todos los planes, incluido Gratis: clave propia cifrada en
  `ai_settings`, OpenAI, Anthropic o gateway compatible con OpenAI, prueba de
  conexión, modelo por agente y tope mensual de tokens por agente.
- El consumo se mide por empresa, función y modelo, y cada fila dice de quién
  era la clave (`source: own | platform`), que es lo que separa lo que paga la
  empresa de lo que paga Driony.

Lo que **no** existe y el documento exige:

1. **Modalidad explícita.** Hoy la modalidad es implícita: con clave propia es
   BYOK; sin clave, IA de Driony. No hay `ai_billing_mode` ni un registro de
   quién la cambió. Quitar la clave «vuelve» a la IA de Driony en silencio.
2. **Facturación mixta no declarada.** Una empresa con solo clave de Anthropic
   usa la clave de OpenAI de Driony para embeddings, transcripción de audios y
   descripción de imágenes. Se mide como `platform` y entra en el tope en
   dólares, pero la UI y los docs no lo dicen (los docs dicen lo contrario).
3. **Estado y validación de la credencial.** No hay `credential_status`,
   `validated_at` ni rotación auditada; «Probar conexión» existe pero no deja
   rastro.
4. **Lista de hosts permitidos y tiempo límite.** `openaiBaseUrl` acepta
   cualquier URL y la API la llama sin timeout: superficie SSRF y llamadas
   colgadas.
5. **Modalidad fijada en el trabajo encolado.** Los trabajos resuelven la
   credencial al ejecutarse, no al encolarse.
6. **Auditoría de cambios de IA por empresa.** Solo existe el diario del
   operador de plataforma; nada a nivel de empresa.

Tres contradicciones entre la oferta pública y el código, y una decisión de
producto que el documento deja abierta y hoy ya está tomada de hecho (BYOK en
Gratis), se detallan en §3 y §8.

## 2. Inventario verificable

### 2.1 Catálogo y derechos de plan

| Qué | Dónde |
|---|---|
| Planes, límites, cupo de IA, prueba de 15 días con 500 conversaciones | `packages/shared/src/plans.ts` (`PLANS`, `effectivePlan`, `TRIAL_AI_CONVERSATIONS`) |
| Paquetes extra (1.000/USD 12, 3.000/USD 29, 6 meses), tope en dólares, funciones que cuentan | `packages/shared/src/ai-usage.ts` (`AI_PACKS`, `includedAiCapUsd`, `AI_INCLUDED_COUNTED = agent, follow_up`) |
| Comprobación de límites al añadir, retención de adjuntos | `apps/api/src/modules/plans/plans.service.ts`, `media-retention.service.ts` |
| Cambio de plan, prueba, paquetes (manual, con diario) | `apps/api/src/modules/platform/platform.service.ts`, `platform_audit_log` |
| Pruebas | `apps/api/test/plans.test.ts` (8), `ai-keys.test.ts` (13, cupo y prioridad de claves) |

### 2.2 Credenciales y modalidad

| Qué | Dónde |
|---|---|
| Fila por empresa: proveedor, claves cifradas, modelos, URL base | `apps/api/prisma/schema.prisma` → `model AiSetting` (`ai_settings`) |
| Resolución de credencial por llamada (clave propia › entorno si se comparte › IA de Driony) | `apps/api/src/modules/ai/ai-settings.service.ts` (`resolve`, `resolveFor`, `included`, `allowsConversation`) |
| Cifrado en reposo AES‑256‑GCM, clave derivada de `APP_ENCRYPTION_KEY`, sal fija | `apps/api/src/common/utils/secret-box.ts` |
| Enrutador que elige el adaptador en cada llamada y registra el consumo | `apps/api/src/modules/ai/providers/routing-llm.provider.ts` |
| Adaptadores | `providers/openai-llm.provider.ts`, `providers/anthropic-llm.provider.ts`, `providers/fake-llm.provider.ts` |
| Embeddings (OpenAI o Voyage) | `apps/api/src/modules/knowledge/embeddings/*`, clave Voyage en `integration-settings.service.ts` |
| Audio e imágenes | `apps/api/src/modules/ai/media-understanding.service.ts` |
| Endpoints de ajustes (solo rol ADMIN) | `apps/api/src/modules/ai/ai-settings.controller.ts`: `GET/PATCH /ai/settings`, `POST /ai/settings/test` |
| Pantalla | `apps/web/src/features/settings/AiSettings.tsx` (modalidad activa, medidor del cupo, claves enmascaradas, modelos, URL base, probar) |
| Interruptores de plataforma | `.env.example`: `AI_INCLUDED`, `AI_INCLUDED_MODEL`, `AI_SHARED_KEYS`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |

### 2.3 Consumo, cupos y recargas

| Qué | Dónde |
|---|---|
| Registro por llamada: función, modelo, tokens, conversación, `source` | `model AiUsage` (`ai_usage`), `apps/api/src/modules/ai/ai-usage.service.ts` (`record`, `includedUsage`, `countedThisMonth`, `report`) |
| Definición de «conversación»: `conversationId` distinto, función `agent` o `follow_up`, `source = platform`, mes UTC | `ai-usage.service.ts` → `includedUsage` |
| Paquetes y su gasto (uno por conversación y mes, atómico) | `model AiPack`, `model AiPackUse`, `apps/api/src/modules/ai/ai-packs.service.ts` |
| Puerta del agente: cupo lleno → termina las que atendía o gasta extra; sin extra → traspaso al equipo | `agent.service.ts:115,894`, `autopilot.service.ts:241`, motivos en `agent-config.schema.ts` |
| Tope mensual de tokens por agente | `agent.service.ts` → `checkBudget` (sobre `ai_runs`) |
| Informe para la empresa (por función, modelo, día, y `own` frente a `platform`) | `ai-usage.controller.ts`, `AiUsageSettings.tsx`, medidor en cabecera (`.ai-meter`) |
| Cifras de plataforma (gasto propio y de Driony, empresas al cupo, al tope) | `platform.service.ts` → `health()` / `overview()` |

### 2.4 Copilot y Autopilot

Son modos de la conversación (`AiMode` en `messaging.schema.ts`), no planes:
`OFF | COPILOT | AUTOPILOT`, por chat, con `autopilotByDefault` por agente. No
hay ningún derecho de plan que los limite. Coincide con el documento.

### 2.5 Implementaciones

Separadas del SaaS, en la consola de plataforma, con `aiBillingMode`
(`BYOK | MANAGED | UNDECIDED`) por cotización y la propuesta al cliente con la
mensualidad y el modo de IA aparte. Ver `docs/COTIZADOR-IMPLEMENTACIONES.md`.

## 3. Matriz de auditoría

Estados: **implementado**, **parcial**, **no existe**, **decisión**.

### 3.1 Decisión de negocio (§1 del documento)

| Requisito | Estado | Evidencia y nota |
|---|---|---|
| Dos modos en el mismo plan (administrada / BYOK) | parcial | Existen los dos, pero la modalidad es implícita (clave propia presente o no), no una elección guardada. |
| BYOK incluido sin recargo en planes de pago, sin descuento | implementado | Ninguna comprobación de plan en `updateSettings`; precio no cambia. |
| BYOK en Gratis «por decidir, sin ampliar» | decisión | **Ya está permitido** técnicamente (cualquier empresa guarda clave). Restringirlo sería quitar un beneficio en uso: no se toca sin aprobación. |
| Copilot/Autopilot no son suscripciones | implementado | `AiMode` por conversación. |
| Una solicitud, una modalidad; no restar créditos administrados a BYOK | parcial | `sourceFor()` decide `own`/`platform` por proveedor del modelo, no por la credencial realmente usada. Funciona porque la IA de Driony es solo OpenAI y una clave propia de OpenAI siempre gana, pero el dato se infiere en vez de fijarse en la llamada. |
| Cargos de Meta aparte, nunca «incluidos» | implementado | Precios, landing y `planes.md` lo dicen; no hay facturación de Meta en el producto. |
| Implementación cotizada aparte | implementado | Cotizador interno (otro documento). |
| No crear planes «Pro BYOK» / «Pro administrado» | implementado | No existen; `PLANS` sigue con cuatro planes. |
| Cupos 100/500/2.000/6.000 verificados contra código, docs y web | implementado | `plans.ts`, `planes.md` línea 15, `Pricing.tsx` y `Landing.tsx` leen `PLANS`. Contratos: no hay cobro automático, el operador cambia el plan a mano. |

### 3.2 Experiencia en Ajustes › Inteligencia artificial (§2)

| Requisito | Estado | Evidencia y nota |
|---|---|---|
| Ver modalidad activa y modelos compatibles | implementado | `AiSettings.tsx`: «Activo: IA de Driony» o «tu clave»; modelos sugeridos en `ai-settings.schema.ts`. |
| Elegir «IA incluida» o «mi propia API key» | parcial | Se elige poniendo o quitando la clave; no hay conmutador explícito. |
| Solo proveedores realmente soportados | implementado | OpenAI, Anthropic y gateways compatibles con OpenAI; **no** se muestra Gemini. Voyage solo para embeddings, en Integraciones. |
| Flujo seguro de alta con verificación | parcial | Clave cifrada, nunca devuelta (`maskSecret`); «Probar conexión» hace una llamada real, pero no guarda resultado ni fecha. |
| Modelo válido y advertencia de costos | parcial | Modelo libre por proveedor y por agente; el coste se muestra en Consumo de IA como estimación a precio de lista. No hay aviso al elegir modelo. |
| Estado de conexión (`sin configurar / válida / inválida / cuota agotada / suspendida`) | no existe | Solo `configured` y `source`. El error de proveedor se ve al probar o en el log. |
| Consumo separado Copilot / Autopilot, estimado frente a facturado | parcial | Por función (`agent`, `copilot`, `media`…) y por `own`/`platform`; etiquetado como estimación con fecha de precios. No hay consumo «facturado por el proveedor» (no existe esa integración). |
| Rotar/revocar y ver quién cambió la modalidad | parcial | Rotar = pegar otra clave; revocar = guardar vacía. Sin historial ni autor. |
| Alertas y límites internos explicados como best‑effort | parcial | Tope mensual de tokens por agente (corta) y tope en dólares de la IA de Driony. No hay límite de gasto por empresa en BYOK. |
| No pedir la clave por correo/WhatsApp | implementado | La UI la recibe y cifra; el consultor no la ve. Falta decirlo en la guía de implementación. |

### 3.3 Facturación y consumo (§3)

| Requisito | Estado | Evidencia y nota |
|---|---|---|
| Credencial administrada solo con modalidad autorizada | parcial | Autorización = `AI_INCLUDED=true` global + plan con cupo. Hoy todos los planes, incluido Gratis, la tienen. |
| Medir por empresa, función, solicitud, proveedor/modelo; separar unidades técnicas de comerciales | implementado | `ai_usage` (tokens) y conteo de conversaciones distintas; informe en Ajustes. No hay `request_id` idempotente en `ai_usage` (ver riesgos). |
| Cupos, bloqueos y recargas con la definición vigente de conversación | implementado | `allowsConversation`, `AiPacksService.consume` atómico (`FOR UPDATE SKIP LOCKED`, único por conversación y mes). |
| Errores de proveedor y cuota agotada sin confirmar falsamente | implementado | El agente pasa el chat a Pendientes con el motivo; el modo simulado nunca responde a clientes. |
| Recargas auditables, idempotentes y conciliables | parcial | Paquetes con diario de plataforma y precio pagado; sin conciliación con un cobro (no hay cobro automático). |
| BYOK solo con la credencial del tenant correcto, por backend | implementado | Caché por `orgId`, RLS en `ai_settings`, llamadas desde la API; el navegador nunca ve la clave. |
| BYOK no implica infraestructura ilimitada | implementado | Límites de plan (números, usuarios, contactos, activos) siguen aplicando. |
| No descontar créditos administrados por solicitudes BYOK | implementado | `source = own` no cuenta para el cupo (`includedUsage` filtra `platform`). |
| **Prohibido el fallback silencioso** a claves de Driony cuando la BYOK falla | parcial | Si la llamada con clave propia falla, el error se propaga: no hay reintento con la clave de Driony. Pero si la empresa **borra** su clave, pasa a la IA de Driony sin más aviso que el texto de Ajustes; y con solo Anthropic, OpenAI de Driony cubre embeddings, audio e imágenes. |
| Documentar qué operación usa qué credencial | no existe | Es así por código: chat/clasificación → proveedor activo; embeddings y audio → OpenAI (propia o de Driony); imágenes → proveedor activo. No está escrito para el cliente. Los docs dicen lo contrario (§3.6). |
| Cambio de modalidad: afecta a ejecuciones nuevas, sin reescribir consumo | implementado | `ai_usage` es inmutable; la caché se invalida al guardar. |
| Modalidad fijada en el trabajo encolado o regla explícita | no existe | `ai-reply.processor.ts` y `flow.processor.ts` resuelven al ejecutar (`runJobInOrg`). Regla implícita: «la modalidad vigente al ejecutar». Hay que documentarla o fijarla. |
| Historial de cambios de modalidad | no existe | Ni modelo ni endpoint. |
| Separar en panel/FAQ suscripción, IA y Meta | implementado | `Pricing.tsx` («La IA, como prefieras»), FAQ de la landing, `planes.md`. |

### 3.4 Seguridad y privacidad (§4)

| Requisito | Estado | Evidencia y nota |
|---|---|---|
| Aislamiento multi‑tenant de credencial y consumo | implementado | Capa 1 (`TENANT_MODELS` + `AsyncLocalStorage`) y capa 2 (RLS, `app.current_org`); `AiSettingsService.cache` y `includedCache` por `orgId`; `AiPacksService` filtra por `orgId` además de RLS. **Falta una prueba que lo demuestre para `ai_settings` y `ai_usage`** (`rls.test.ts` no las cubre). |
| Secretos cifrados, nunca al frontend, ni en logs | implementado | `secret-box.ts`; DTO solo `masked`; los logs citan proveedor y empresa, no claves. Punto a revisar: `aiConnectionTest.message` devuelve hasta 300 caracteres del error del proveedor (puede incluir fragmentos de la petición, no la clave). |
| Permisos: solo administradores | implementado | `@Roles(Role.ADMIN)` en el controlador. Los permisos finos (`permissions.ts`) no incluyen Ajustes de IA, así que un usuario con rol inferior no entra. |
| Auditoría de cambios, intentos fallidos y rotaciones | no existe | Nada por empresa. |
| Lista de hosts permitidos, timeout, SSRF | no existe | `openaiBaseUrl` admite cualquier cadena de hasta 300 caracteres y `fetch` sin `AbortSignal` en `openai-llm.provider.ts:213`, `media-understanding.service.ts` y `openai-embedding.provider.ts`. Mitiga: solo con clave propia, nunca con la de Driony (`includedCreds` fuerza `baseUrl: null`). |
| Qué datos del chat van al proveedor del cliente | parcial | Lo cuenta `agentes.md` por funciones; no hay un aviso de privacidad al activar BYOK. |
| Límites de concurrencia, colas y frecuencia por empresa | parcial | Colas BullMQ por organización y `replyDelaySec`; no hay rate limit por empresa en llamadas de IA (`auth` y `campaigns` sí tienen). |
| Migraciones con rollback | implementado | Migraciones SQL idempotentes aplicadas por `entrypoint.sh`; claves actuales intactas si no cambia `APP_ENCRYPTION_KEY`. |

### 3.5 Modelo lógico (§5)

| Campo pedido | Hoy |
|---|---|
| `ai_billing_mode` | no existe (implícito) |
| `ai_provider`, `model_id` | `AiSetting.provider` (`auto|openai|anthropic|fake`), `openaiModel`, `anthropicModel`, y modelo por agente en `AgentConfig.model` |
| `credential_reference`, `credential_status`, `validated_at`, `rotated_at` | solo `openaiKeyEnc` / `anthropicKeyEnc`; sin estado ni fechas |
| `budget_warning_threshold`, `budget_hard_limit` | solo `AgentConfig.monthlyTokenBudget` (por agente, corta) y aviso al 80 % del cupo administrado |
| `updated_by`, `updated_at`, `version` | solo `updatedAt` |
| Uso por operación con `billing_mode_at_execution`, `request_id`, `estimated_cost`, `status` | `ai_usage` tiene función, modelo, tokens, conversación y `source`; falta `request_id` (idempotencia) y `status`; el coste se calcula al leer, no se guarda |
| Derechos de plan, cuotas de plataforma y créditos de IA como conceptos separados | implementado: `features`, `limits` y `aiConversations` son campos distintos de `PlanDef` |

### 3.6 Contradicciones entre oferta pública y código

1. **`apps/web/content/docs/agentes.md`** (líneas 15, 76 y 90) dice «sin clave
   no hay agente» y que el copiloto, los asistentes y la búsqueda del
   conocimiento funcionan «todo con tu propia clave» y que «Driony no cobra nada
   por la IA». Desde la IA incluida, el agente, el copiloto y la indexación
   funcionan sin clave con la de Driony. `planes.md` sí está al día; `agentes.md`
   no.
2. **`agentes.md` línea 135**: «con solo Anthropic, los audios no se
   transcriben». En SaaS con IA incluida sí se transcriben, con la clave de
   OpenAI de Driony (`resolveFor("openai")` → `includedCreds`). Es un gasto de
   plataforma que el cliente no sabe que ocurre.
3. **`AiSettings.tsx`** promete que al quitar la clave «el agente vuelve a usar
   la IA de Driony». Es cierto, y es exactamente el cambio de modalidad sin
   aviso ni rastro que el documento quiere evitar.

## 4. Riesgos actuales

| Riesgo | Gravedad | Dónde |
|---|---|---|
| SSRF y llamadas colgadas con `openaiBaseUrl` libre y sin timeout (solo con clave propia, desde la red de la API) | alta | `openai-llm.provider.ts`, `media-understanding.service.ts`, `openai-embedding.provider.ts` |
| Gasto de plataforma no declarado: embeddings, audio e imágenes con la clave de Driony para empresas con solo Anthropic | media (acotado por el tope en dólares) | `ai-settings.service.ts` → `resolveFor` |
| Cambio de modalidad sin autor ni historial; una clave borrada por error cambia la factura de la empresa | media | `ai-settings.service.ts` → `updateSettings` |
| `source` inferido por proveedor del modelo, no por credencial usada: cualquier futuro proveedor administrado distinto de OpenAI rompería el conteo | media | `ai-usage.service.ts` → `sourceFor` |
| Sin `request_id`: un reintento de trabajo que termina en dos llamadas registra dos consumos (el cupo por conversación sí es idempotente; los tokens y el tope en dólares no) | baja | `ai-usage.service.ts` → `record` |
| Modalidad resuelta al ejecutar: un trabajo encolado antes de borrar la clave corre con la IA de Driony | baja (es la regla «vigente al ejecutar», pero no está escrita) | `ai-reply.processor.ts`, `flow.processor.ts`, `follow-up.service.ts` |
| Sin prueba automática de aislamiento para `ai_settings` / `ai_usage` | media | `apps/api/test/rls.test.ts` |
| Mensaje de error del proveedor devuelto al cliente (300 caracteres) | baja | `ai-settings.controller.ts` → `test` |
| BYOK en Gratis activo de hecho: restringirlo quitaría un beneficio en uso | decisión | `AiSettingsController` sin comprobación de plan |

## 5. Diseño mínimo propuesto

Reutiliza lo que hay; nada de un segundo sistema de créditos.

### 5.1 Datos (una migración idempotente)

En `ai_settings`:
- `billingMode TEXT NOT NULL DEFAULT 'MANAGED'` (`MANAGED | BYOK`). Migración:
  `BYOK` donde haya `openaiKeyEnc` o `anthropicKeyEnc`, `MANAGED` en el resto.
  Así nadie cambia de comportamiento el día del despliegue.
- `credentialStatus TEXT NOT NULL DEFAULT 'unconfigured'`
  (`unconfigured | valid | invalid | exhausted | revoked`), `validatedAt`,
  `rotatedAt`, `updatedBy`.
- `byokBudgetUsd NUMERIC NULL` y `byokBudgetMode TEXT` (`warn | block`), con la
  advertencia en la UI de que es un freno local, no del proveedor.

Nueva tabla `ai_setting_events` (RLS como el resto de tablas de empresa):
`orgId`, `userId`, `action` (`mode_changed | key_set | key_rotated | key_revoked
| test_ok | test_failed | budget_changed`), `provider`, `details JSONB` (sin
valores sensibles), `createdAt`.

En `ai_usage`: `billingMode TEXT` (`MANAGED | BYOK`, fijado en la llamada) y
`requestId TEXT` con índice único parcial (`orgId, requestId`) para que un
reintento no duplique. `source` se mantiene por compatibilidad y pasa a
derivarse de `billingMode`.

### 5.2 Flujos

- **Selección centralizada.** `AiSettingsService.resolve()` devuelve también
  `billingMode` y `credentialStatus`, y `AiUsageService.record()` recibe el
  modo desde `ResolvedCredentials` en vez de inferirlo. Un solo punto decide y
  un solo punto registra, como hoy, pero sin inferencia.
- **Modo BYOK estricto.** Con `billingMode = BYOK`, `resolveFor("openai")` ya
  no cae en la IA de Driony: si la empresa no tiene clave de OpenAI, la
  operación (embeddings, audio) falla con mensaje claro y la UI lo avisa al
  elegir Anthropic. Alternativa a decidir (§8): declarar en la UI «audio e
  indexación usan la IA de Driony aunque tengas clave de Anthropic».
- **Cambio de modalidad explícito** desde Ajustes, con confirmación que explica
  consecuencias (cupo, extra, qué pasa con lo encolado) y evento auditado.
  Borrar la clave con modo BYOK deja el estado en `revoked` y el agente para
  con motivo «Falta la clave de IA», sin volver solo a la administrada.
- **Trabajos encolados.** Regla escrita y probada: la modalidad es la vigente
  al ejecutar; el trabajo registra la que usó. Fijarla al encolar añadiría
  casos raros (clave revocada entre encolar y correr) sin beneficio.
- **Validación de proveedor.** Lista de hosts permitidos para `openaiBaseUrl`
  (api.openai.com y una lista configurable `AI_ALLOWED_BASE_HOSTS`), rechazo
  de IPs privadas y `AbortSignal.timeout` (60 s chat, 120 s audio) en todas las
  llamadas salientes.
- **Estado de conexión.** «Probar conexión» guarda `credentialStatus` y
  `validatedAt`; un 401/403 del proveedor en producción marca `invalid` y un
  429 de cuota `exhausted`, sin reintentar con otra credencial.

### 5.3 Pantalla

Ajustes › Inteligencia artificial pasa a tener arriba el conmutador «IA incluida
con Driony» / «Mi propia API key», el estado de la credencial, quién la cambió y
cuándo, y abajo el consumo del mes separado en Copilot, Autopilot y resto, con
la etiqueta «estimado a precio de lista».

### 5.4 Documentación

Corregir `agentes.md` (§3.6) y añadir a `planes.md` qué operación usa qué
credencial y la regla de los trabajos encolados.

## 6. Plan de trabajo

Estimaciones en días de una persona, con pruebas incluidas.

### P0 · Seguridad, contratos y consistencia (sin cambiar la oferta)

| # | Tarea | Depende de | Estimación |
|---|---|---|---|
| 1 | Hosts permitidos y timeout en las tres llamadas salientes de OpenAI/gateway | — | 0,5 d |
| 2 | Prueba de aislamiento RLS para `ai_settings`, `ai_usage`, `ai_packs` en `rls.test.ts` | — | 0,5 d |
| 3 | `billingMode` y `requestId` en `ai_usage`, fijados desde la resolución (`record` deja de inferir) | — | 1 d |
| 4 | Migración `billingMode` + `credentialStatus` en `ai_settings` con la regla de arranque (clave → BYOK) | — | 0,5 d |
| 5 | `ai_setting_events` y eventos en guardar/probar/borrar | 4 | 1 d |
| 6 | Corregir `agentes.md`; escribir la regla de trabajos encolados y la tabla «operación → credencial» | — | 0,5 d |
| 7 | Decidir y aplicar la política de facturación mixta (BYOK estricto o declarada), §8.2 | 3, 4 | 1 d |

Total P0: ~5 días. Ninguna tarea cambia precios, cupos ni la experiencia de
quien ya usa el producto, salvo la 7 si se elige «estricto» (entonces hay que
avisar a las empresas con solo Anthropic).

### P1 · UX y operación

| # | Tarea | Depende de | Estimación |
|---|---|---|---|
| 1 | Conmutador de modalidad con confirmación y consecuencias | P0‑4, P0‑5 | 1,5 d |
| 2 | Estado de conexión en la UI y marcado automático `invalid`/`exhausted` desde los adaptadores | P0‑4 | 1 d |
| 3 | Consumo separado Copilot / Autopilot / resto, estimado frente a sin precio | — | 1 d |
| 4 | Presupuesto BYOK por empresa (aviso y, opcional, bloqueo) | P0‑4 | 1 d |
| 5 | Guía de BYOK asistido para implementaciones (el consultor no ve la clave) | — | 0,5 d |
| 6 | Mensajes de precio consolidados: software, IA, Meta, implementación (web y docs) | decisión §8.6 | 0,5 d |

Total P1: ~5,5 días.

### P2 · Después

Alertas de presupuesto por modelo y función; informe de rentabilidad de la IA
administrada por empresa en la consola (ya hay cifras globales); rate limit de
llamadas de IA por empresa; políticas de modelos permitidos; conciliación de
paquetes con cobros cuando exista cobro automático.

## 7. Plan de pruebas

Automáticas (`apps/api/test`, `node:test`, mismo patrón que `ai-keys.test.ts`):

- **A · BYOK en plan de pago**: con `billingMode = BYOK` y clave propia, chat,
  copiloto y agente registran `BYOK`; `includedUsage` no sube; sin clave de
  OpenAI, embeddings y audio fallan con mensaje (o usan la de Driony, según §8.2)
  y lo registran como `MANAGED`.
- **B · IA administrada**: sin clave, cupo del plan, `full` y `exhausted`,
  traspaso con motivo, paquetes gastados una vez por conversación y mes (ya
  cubierto en `ai-keys.test.ts`; añadir `billingMode`).
- **C · Aislamiento**: con el rol `crm_app` y RLS (`crm_rls_test`), la empresa
  A no lee ni actualiza `ai_settings`, `ai_usage` ni `ai_packs` de B; un trabajo
  de A corre con `orgId` de A (`job-org.test.ts` ya lo prueba para el contexto).
- **D · Error y gasto**: clave BYOK inválida → error, sin reintento con otra
  credencial, sin consumo administrado, `credentialStatus = invalid`; un
  `requestId` repetido no duplica `ai_usage`.
- **E · Cambio de modo**: cambiar `MANAGED ↔ BYOK` crea el evento, no altera
  filas anteriores; un trabajo encolado usa la modalidad vigente al ejecutar y la
  registra.
- **F · Transparencia**: prueba de contrato que lee `PLANS` y comprueba que
  `planes.md`, `Pricing.tsx` y la landing muestran los mismos cupos y precios
  (hoy manual).
- **Seguridad**: `openaiBaseUrl` con host no permitido o IP privada se rechaza;
  la llamada aborta al pasar el timeout.

Manuales (consola y panel en modo multi, como en `docs/COTIZADOR-IMPLEMENTACIONES.md` §7):
alta de clave, probar, rotar, borrar, ver eventos; empresa con solo Anthropic
enviando un audio.

## 8. Preguntas bloqueantes para el responsable

1. **BYOK en Gratis.** Hoy funciona. ¿Se mantiene (recomendado: no quitar un
   beneficio en uso) o se restringe a planes de pago con aviso previo?
2. **Facturación mixta.** Para una empresa con solo clave de Anthropic, ¿los
   embeddings, los audios y las imágenes siguen usando la IA de Driony (hay que
   decirlo y contarlo dentro de su tope) o BYOK pasa a ser estricto y esas
   funciones exigen clave de OpenAI?
3. **Modalidad única por empresa.** Recomendación del documento y del código:
   una por empresa. El modelo sí es por agente. ¿Confirmas?
4. **Créditos administrados al pasar a BYOK.** No se convierten en dinero, no
   se gastan con BYOK y conservan su vencimiento (los paquetes vencen a los 6
   meses). ¿Confirmas que esa es la política?
5. **Definición de conversación.** La del código: contacto distinto atendido por
   el agente o un seguimiento automático, con la IA de Driony, en el mes UTC;
   copiloto, asistentes, audio e imágenes no cuentan conversaciones pero sí
   entran en el tope en dólares. ¿Se adopta como definición contractual?
6. **Límites de gasto BYOK.** ¿Aviso local, bloqueo local, o nada (solo el del
   proveedor)? Recomendación: aviso por defecto, bloqueo opcional, y decir que
   no sustituye al del proveedor.
7. **Qué servicios cubre el cupo.** Hoy cubre todo lo que corre con la clave de
   Driony (agente, copiloto, asistentes, indexación, audio, imágenes) bajo el
   tope en dólares, y cuenta conversaciones solo del agente y seguimientos.
   ¿Se mantiene?
8. **Servicios de implementación en la web.** El documento lo deja para
   después; la landing no los menciona. ¿Cuándo y con qué precios?

## 9. Qué no se ha tocado

Precios, cupos, planes, claves, datos de clientes, comportamiento de
facturación y producción. Este documento es el entregable previo que exige el
handoff; cualquier tarea de §6 empieza solo con autorización explícita.

## 10. Ejecución de P0 (2026-11-05)

Autorizada con «comienza». Nada de esto toca producción: la migración está
aplicada en la base de desarrollo y lista para `migrate deploy`; el despliegue
lo decide el responsable.

### 10.1 Decisiones de §8 aplicadas por defecto (reversibles)

Las tres preguntas que bloqueaban P0 se resolvieron con la recomendación del
informe, sin cambiar la oferta. Cada una se puede revertir sin migración:

| Pregunta | Aplicado | Cómo revertir |
|---|---|---|
| 1 · BYOK en Gratis | Se mantiene (no se quita un beneficio en uso). `planes.md` lo dice: «en todos los planes, Gratis incluido» | Comprobación de plan en `updateSettings` antes de cifrar la clave |
| 2 · Facturación mixta | **Declarada**, no estricta: con solo Anthropic, audio, visión y embeddings corren con la IA de Driony dentro del tope y se registran como `MANAGED`. Está escrito en `planes.md` y `agentes.md` | Quitar la rama `hasOtherKey` de `resolveFor("openai")` y avisar a las empresas con solo Anthropic |
| 3 · Modalidad única por empresa | Sí: una columna `billingMode` por empresa; el modelo sigue siendo por agente | — |

### 10.2 Qué se hizo

| # P0 | Estado | Dónde |
|---|---|---|
| 1 · Hosts permitidos y timeout | Hecho. `ai-http.ts`: `aiFetch` (host admitido + `AbortSignal.timeout`, 60 s chat/visión/embeddings, 120 s audio) en las tres llamadas de OpenAI/gateway y en la de visión de Anthropic; el SDK de Anthropic con `timeout`. En SaaS la URL base exige https, rechaza IPs y hosts internos y solo admite `api.openai.com`, `api.anthropic.com`, `api.groq.com`, `api.deepseek.com`, `openrouter.ai`, el host de `OPENAI_BASE_URL` y los de `AI_ALLOWED_BASE_HOSTS`. En instalación propia vale cualquier URL (Ollama). Se valida al guardar (400 con motivo) y otra vez en cada llamada | `apps/api/src/modules/ai/ai-http.ts`, `openai-llm.provider.ts`, `anthropic-llm.provider.ts`, `media-understanding.service.ts`, `openai-embedding.provider.ts` |
| 2 · Prueba RLS | Hecho. SQL crudo sin WHERE desde A sobre `ai_settings`, `ai_setting_events`, `ai_usage`, `ai_packs`; UPDATE cruzado toca 0 filas; INSERT cruzado se rechaza; el servicio real con el rol `crm_app` deja el evento en su empresa | `apps/api/test/rls.test.ts` |
| 3 · `billingMode` y `requestId` en `ai_usage` | Hecho. `ResolvedCredentials.billingMode` sale de la credencial elegida (clave de la plataforma → `MANAGED`; clave de la empresa → `BYOK`); cada adaptador lo devuelve en `LlmResponse` y `record()` lo copia; `source` se deriva de él (se borró `sourceFor`, que lo infería por el modelo). `requestId` = id de la respuesta del proveedor; índice único `(orgId, requestId)` (los NULL no chocan) y el duplicado se ignora | `ai-usage.service.ts`, `llm.types.ts`, `routing-llm.provider.ts` |
| 4 · Migración `ai_settings` | Hecho. `billingMode`, `credentialStatus`, `validatedAt`, `rotatedAt`, `updatedBy`; arranque: clave guardada → `BYOK` + `untested`, resto `MANAGED`. El relleno corre solo cuando la columna se crea (idempotente de verdad). CHECKs en ambas tablas | `prisma/migrations/20261105090000_ai_billing_mode/` |
| 5 · `ai_setting_events` | Hecho. Tabla con RLS; eventos `key_set`, `key_rotated`, `key_revoked`, `mode_changed`, `settings_changed`, `test_ok`, `test_failed` (`budget_changed` reservado para P1-4), con `userId` del JWT y `details` sin la clave (solo sus últimos caracteres; de la URL base, solo el host). `GET /ai/settings/events` y el historial plegable en Ajustes › IA | `ai-settings.service.ts`, `ai-settings.controller.ts`, `AiSettings.tsx` |
| 6 · Documentación | Hecho. `agentes.md` corregido (§3.6); `planes.md` con la tabla «qué credencial usa cada función» y la regla de los trabajos encolados | `apps/web/content/docs/` |
| 7 · Facturación mixta | Decisión por defecto «declarada» (§10.1) | `resolveFor("openai")` |

Regla nueva, escrita en el código y en los docs: una empresa `BYOK` sin clave
utilizable (borrada por fuera, cifrado roto, rechazada) **no** cae en la IA de
Driony; `resolve()` devuelve el simulado y el agente para con «Falta la clave
de IA». Hoy la modalidad sigue a la clave (guardar → `BYOK`, borrar →
`MANAGED`) y ese cambio ya no es silencioso: queda en el historial con autor.
El conmutador explícito con confirmación es P1-1.

Desvíos respecto a §5, a propósito: se añadió el estado `untested` (clave
guardada y no probada; `unconfigured` habría mentido) y la acción
`settings_changed`; el índice de `requestId` es único completo y no parcial,
para que Prisma lo conozca (`@@unique`); la lista fija de hosts incluye los
gateways que la documentación ya prometía, para no quitar nada a nadie.

### 10.3 Pruebas

- `npm run test:aibilling -w @crm/api` (nuevo): modalidad que sigue a la
  clave, historial sin claves en claro, URL base admitida/rechazada, `aiFetch`
  sin red para hosts no admitidos y timeout legible, estado tras «Probar
  conexión», BYOK sin fallback, facturación mixta declarada, consumo con
  modalidad copiada y sin duplicados.
- `npm run test:aikeys -w @crm/api`: sin cambios de comportamiento.
- `npm run test:rls -w @crm/api`: aislamiento de las tablas de IA.

### 10.4 Pendiente (P1)

Conmutador de modalidad con confirmación; `invalid`/`exhausted` marcados desde
los adaptadores en producción (hoy solo desde «Probar conexión»); consumo
separado Copilot/Autopilot; presupuesto BYOK; guía de BYOK asistido; mensajes
de precio consolidados. Y las preguntas 4 a 8 de §8 siguen abiertas.
