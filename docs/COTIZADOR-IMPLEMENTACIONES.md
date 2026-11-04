# Cotizador interno de implementaciones

Herramienta del operador de Driony para diagnosticar, estimar y cotizar la
implementación de un cliente. Vive en la **consola de plataforma**
(`admin.<dominio>` › pestaña «Implementaciones») y solo ahí: ninguna empresa
lo ve, y nada de lo que hace toca los planes públicos, los cobros, la IA ni
las oportunidades de los clientes.

Origen: `DRIONY_COTIZADOR_IMPLEMENTACIONES_AGENT_HANDOFF.md` (v1.0, 04‑11‑2026).
Este documento recoge la auditoría previa, las decisiones tomadas y lo que
quedó construido en la P0 y en la P1 (ambas el 04‑11‑2026).

## 1. Auditoría: qué había y qué se reutilizó

| Necesidad | Estado antes | Qué se hizo |
|---|---|---|
| Área interna de Driony con auditoría | Existía: consola de plataforma (`modules/platform`, `PlatformAdminGuard`, `platform_audit_log`) | El cotizador es un controlador y un servicio más dentro de `PlatformModule`, con el mismo guard y el mismo diario |
| Entidades de cotización, partidas, versiones | No existían | Tres tablas nuevas de plataforma (sin `orgId` como dueño) |
| Motor financiero | No existía | Funciones puras en `@crm/shared` (`implementation-pricing.ts`), con tests |
| Planes y precios públicos | `packages/shared/src/plans.ts` (`PLANS`) | **No se tocó.** La cotización guarda `planKey` y una copia del precio del momento (`planPriceCentsSnapshot`) |
| Roles internos vendedor / aprobador | No existen: una sola cuenta maestra | P0: la aprobación es un paso explícito; bajo mínimo exige motivo y queda en el diario con el correo. Roles reales → P2 |
| Documento exportable, envío por correo | No hay librería PDF ni correo en la pila | P0: «Vista del cliente» en pantalla. P1: hoja imprimible `/platform/propuesta/:id` → «Guardar como PDF» del navegador, sin dependencias. Envío por correo sigue sin existir |
| Tarifas, plantillas y referencias configurables | No existía | P1: fila JSON `implementation_pricing_settings`, editable desde «Ajustes», con rastro en el diario |
| Horas y costos reales | No existía | P1: `implementation_actuals` sobre la versión aceptada; presupuesto vs real y margen real en la ficha |
| Inmutabilidad de lo aprobado | Solo en el servicio | P1: triggers `BEFORE UPDATE` / sobre partidas en Postgres (`implementation_quotes_guard`) |

Lo que **no** se construyó a propósito (sección 7 del handoff): cotizador
público, precios autónomos por IA, líneas de suscripción nuevas, facturación
paralela, IA ilimitada.

## 2. Decisiones

1. **Dónde vive:** en la consola de plataforma, no dentro de las empresas. Es
   interno y transversal; requiere `TENANCY_MODE=multi`.
2. **Tablas de plataforma:** `implementation_assessments`, `implementation_quotes`,
   `implementation_quote_items`. No llevan `orgId` como dueño, no están en
   `TENANT_MODELS` ni tienen RLS, igual que `platform_audit_log`. `orgId` es un
   enlace opcional a la empresa cliente con `ON DELETE SET NULL`: borrar la
   cuenta no borra lo cotizado (ARCHITECTURE-MULTITENANT §8).
3. **Dinero en centavos enteros y porcentajes en puntos básicos.** Una moneda
   por cotización (`USD` o `PEN`), sin conversión automática; impuestos solo
   como texto. Nunca flotantes en el motor.
4. **Auditoría en `platform_audit_log`** con acciones `assessment_created`,
   `quote_created | quote_submitted | quote_reopened | quote_approved |
   quote_exception_approved | quote_sent | quote_accepted | quote_rejected |
   quote_cancelled | quote_revised`. Se leen en la pestaña «Diario».
5. **Ofertas de referencia (290 / 590 / 1 200 / 99), tarifas por rol y
   plantillas** son hipótesis internas. Los valores de partida están en
   `DEFAULT_PRICING_SETTINGS` (`@crm/shared`); lo guardado desde «Ajustes» los
   sustituye y cada cambio queda en el diario. No aparecen en la web pública.
6. **Cliente en P0:** texto libre + enlace opcional a `Organization`. El enlace
   a una oportunidad del CRM propio de Driony queda para P1.

## 3. Modelo de datos

```
implementation_assessments        diagnóstico (pasos 1–2)
  quoteNumber  COT-2026-0007      se asigna con la primera cotización; lo comparten las versiones
  orgId?       → organizations    SET NULL
  scope JSONB                     validado con assessmentScopeSchema
  riskFlags TEXT[]                señales de riesgo marcadas a mano
  complexityScore / complexityBand   calculados en el servidor, nunca aceptados del cliente

implementation_quotes             una fila por versión (pasos 3–4)
  version · @@unique(assessmentId, version)
  status   DRAFT | READY_FOR_REVIEW | APPROVED | SENT | ACCEPTED | REJECTED | EXPIRED | SUPERSEDED | CANCELLED
  parámetros: overheadsCents, contingencyBp, targetMarginBp, roundingCents, proposedPriceCents
  resultado guardado: laborCents … minimumPriceCents, expectedMarginBp, belowMinimum
  textos de la propuesta, validUntil, planKey + planPriceCentsSnapshot, aiBillingMode
  exceptionReason/exceptionBy      aprobación bajo mínimo
  approvedSnapshot JSONB           todo congelado al aprobar

implementation_quote_items        partidas: hours DECIMAL(7,2) × hourlyCostCents + thirdPartyCents + otherCents

implementation_actuals            horas y costos reales sobre la versión aceptada (P1)
  quoteId · category · hours · hourlyCostCents (congelado) · costCents · workedOn DATE · note · createdBy

implementation_pricing_settings   una fila (id = 'default') con settings JSONB validado
                                  con pricingSettingsSchema, updatedBy, updatedAt (P1)
```

Protecciones en la base (CHECK): estados y categorías válidos, margen en
`[0, 10000)`, contingencia y redondeo positivos, importes no negativos. La
secuencia `implementation_quote_number_seq` da el correlativo del número.

Candado de inmutabilidad (P1, migración `20261104150000`): el trigger
`implementation_quotes_guard` impide cambiar importes, textos y parámetros
fuera de `DRAFT`, reescribir la aprobación o su snapshot, y mover un estado
final; `implementation_quote_items_guard` solo deja tocar partidas en
borrador. Un `UPDATE` a mano falla igual que desde la API.

`EXPIRED` **no se guarda**: una cotización `APPROVED` o `SENT` con `validUntil`
pasada se lee como vencida (`effectiveQuoteStatus`). Sin tareas programadas.

## 4. Motor financiero (`packages/shared/src/implementation-pricing.ts`)

```
laborCents       = Σ round(hours_i × hourlyCostCents_i)
externalCents    = Σ thirdParty_i + Σ other_i + overheadsCents
baseCostCents    = laborCents + externalCents
contingencyCents = round(baseCost × contingencyBp / 10 000)
budgetedCents    = baseCost + contingency
minimumCents     = ceilTo(ceil(budgeted × 10 000 / (10 000 − targetMarginBp)), roundingCents)
marginBp         = round((proposed − budgeted) × 10 000 / proposed)
```

Ejemplo del handoff: 20 h × 2 000 ¢ = 40 000; +20 % = 48 000; /0,6 ⇒
**80 000 ¢ = USD 800**. A USD 590 el margen es 18,64 % y `belowMinimum = true`.
El redondeo solo sube. Margen bruto ≠ markup (costo × 1,4 da 28,57 %).

Alertas: `no_items`, `no_hours`, `price_missing`, `below_minimum`,
`negative_contribution`, `margin_below_target`. Las señales de riesgo del
diagnóstico se muestran junto a ellas en el estimador.

## 5. Estados y reglas

```
DRAFT ──submit──▶ READY_FOR_REVIEW ──approve──▶ APPROVED ──send──▶ SENT ──accept──▶ ACCEPTED
  ▲                     │ reopen                                      └──reject──▶ REJECTED
  └─────────────────────┘
cancel: desde DRAFT, READY_FOR_REVIEW, APPROVED, SENT → CANCELLED
revise: desde APPROVED, SENT, ACCEPTED, REJECTED, EXPIRED → nueva versión en DRAFT
```

- Solo se edita en `DRAFT`. Lo demás es de solo lectura; cambiar algo es
  **nueva versión**. La anterior pasa a `SUPERSEDED`, salvo `ACCEPTED`, que se
  conserva como contrato (la nueva versión es un cambio de alcance).
- `submit` exige al menos una partida y un precio propuesto.
- `approve` exige precio, vigencia futura y, si está bajo mínimo, un motivo.
  Al aprobar se guarda `approvedSnapshot` con todo lo que se aprobó.
- `reject` exige motivo (sirve para ajustar estimaciones).
- La complejidad y los números se recalculan siempre en el servidor; la
  pantalla solo previsualiza con la misma función.

## 6. API (todo detrás de `PlatformAdminGuard`, prefijo `/api/v1/platform`)

```
GET    implementations/settings       ajustes vigentes (los de código si nunca se guardaron)
PUT    implementations/settings       reemplazo completo validado; diario: pricing_settings_changed
GET    implementations?search=&archived=1   listado (activos o archivados)
POST   implementations                crear diagnóstico
GET    implementations/:id            ficha con versiones
PATCH  implementations/:id            editar (parcial)
POST   implementations/:id/archive    { archived: boolean }
POST   implementations/:id/quotes     primera versión de la cotización
GET    quotes/:id                     cotización con pricing, items, actuals, actions y publicView
PATCH  quotes/:id                     solo en DRAFT; las partidas, si vienen, reemplazan a todas
POST   quotes/:id/actuals             horas y costos reales (solo ACCEPTED)
DELETE quotes/:id/actuals/:actualId
POST   quotes/:id/:action             submit | reopen | approve | send | accept | reject | cancel | revise
                                      body: { reason?, note? }
```

Hoja imprimible: `GET /platform/propuesta/:id` en la web (solo cuenta
maestra). Recibe únicamente `publicView`; sin aprobar sale con marca
«BORRADOR».

El DTO separa lo interno (`items`, `pricing`, parámetros) de `publicView`, que
es lo único que verá el cliente: sin horas, costos por hora, márgenes ni
mínimos. Una prueba lo comprueba clave por clave.

Web: BFF en `apps/web/src/app/api/bff/platform/{implementations,quotes}/…`,
helpers en `lib/bff.ts`, pantalla en `features/platform/implementations/`.

## 7. Cómo probarlo en local

La consola exige modo SaaS. Desde la raíz del repo:

```bash
# API (puerto 3001)
HASH=$(node scripts/platform-password.mjs "una-clave-de-al-menos-12" | grep HASH | sed 's/.*="\(.*\)"/\1/')
TENANCY_MODE=multi SAAS_BASE_DOMAIN=localhost:3010 PLATFORM_ADMIN_EMAIL=ops@driony.test \
PLATFORM_ADMIN_PASSWORD_HASH="$HASH" npm run dev -w @crm/api

# Web (puerto 3010; AUTH_URL vacío en modo multi)
cd apps/web && SAAS_BASE_DOMAIN=localhost:3010 AUTH_URL= npx next dev -p 3010
```

Consola: `http://admin.localhost:3010/login` → «Implementaciones».

Tests (desde `apps/api`):

```bash
npm run test:implpricing     # motor: ejemplo 800/590, redondeo, protecciones, complejidad, estados
npm run test:implquotes      # servicio con base simulada: flujo, versiones, vista pública, ajustes, horas reales, archivado, aislamiento
npm run test:impldb          # candado en Postgres (recrea crm_rls_test y prueba UPDATEs a mano)
npm run test:platformguard   # el guard rechaza tokens de empresa y correos ajenos
npm run test:rls             # recrea crm_rls_test con las migraciones nuevas
```

Migraciones: `20261104120000_implementation_quotes` (P0) y
`20261104150000_implementation_settings_actuals_guard` (P1). Idempotentes; en
producción las aplica `entrypoint.sh` (`prisma migrate deploy`). En local se
aplicaron con `prisma db execute` + `migrate resolve --applied`. No alteran
tablas existentes.

## 8. Guía de uso comercial

0. **Ajustes** (una vez): tarifas por rol, costo por hora por defecto,
   contingencia, margen, redondeo, vigencia, diagnóstico pagado, condiciones de
   pago, plantillas (Esencial / Híbrida / Personalizada) y ofertas de
   referencia. Cada guardado queda en el diario.
1. **Nuevo diagnóstico** (pasos 1–2): cliente, objetivo, alcance, cinco
   factores de complejidad, señales de riesgo. Se puede guardar y volver.
2. **Abrir cotización** (paso 3): una plantilla añade sus partidas valoradas
   con su tarifa; luego se editan (horas, tarifa o costo/h a mano, terceros,
   otros). Gastos de entrega, contingencia y margen objetivo vienen de los
   ajustes. El mínimo recomendado sale solo; el precio propuesto se escribe
   aparte. Si queda por debajo, el estimador avisa.
3. **Propuesta** (paso 4): plan mensual aparte, modo de IA (BYOK por defecto
   para no inventar ingresos), diagnóstico pagado acreditable una vez como
   línea de descuento, condiciones de pago (50/50), vigencia, cargos de Meta,
   impuestos, soporte, entregables, supuestos, exclusiones, requisitos.
4. **Enviar a revisión → Aprobar.** Bajo mínimo pide motivo; queda en el
   diario con el correo del operador.
5. **Marcar como enviada** (se anota por dónde) → **Aceptada** / **Rechazada**
   (con motivo). Si la vigencia pasa, se lee «Vencida».
6. **Nueva versión** para cualquier cambio. La anterior no se toca.
7. **Vista del cliente** y **Imprimir / PDF**: la hoja se abre en otra pestaña
   y se guarda como PDF desde el navegador. Sin aprobar lleva marca de
   borrador.
8. **Real** (sobre la versión aceptada): horas por día y categoría, costo/h al
   que se valoran y costos externos pagados. La ficha compara con lo
   presupuestado y da el margen real. Nada de esto sale al cliente.
9. **Archivar** cuando el proyecto termina o se pierde; se restaura desde el
   filtro «Archivados».

Nunca escribir claves ni contraseñas en notas, supuestos o entregables.

## 9. Pendiente

**P1 · queda**
- Enlace a una oportunidad del CRM de la empresa propia de Driony (hace falta decidir cuál es esa empresa).
- Control de edición concurrente con `updatedAt` (dos pestañas editando el mismo borrador).
- Panel por tipo de plantilla: cotizado → aceptado y margen real medio.

**P2**
- Cuentas de equipo en la consola con rol vendedor / aprobador (hoy una sola cuenta maestra).
- Estimación sugerida por histórico propio.
- Envío por WhatsApp desde la empresa propia; aceptación electrónica.
- Borrador de diagnóstico asistido por IA, con revisión humana. La IA nunca aprueba, descuenta ni confirma pagos.
