# Arquitectura: Reservas (agenda) en Driony

Fecha: 2026-10-31. Parte de `recon-reserva.md` y `features-reserva.csv`. Diseña solo
el módulo de reservas encima de lo que ya existe; no cambia el stack.

## 1. Stack

Es el de Driony, sin piezas nuevas:

| capa | elección | por qué |
| --- | --- | --- |
| API | NestJS, módulo `bookings` | igual que el resto; la IA, los flujos y el embudo viven ahí |
| base | Postgres + Prisma, migración SQL a mano | `prisma migrate dev` quiere resetear la base; RLS por empresa como cada tabla |
| reglas puras | `@crm/shared/booking` (TypeScript sin dependencias) | el motor de franjas se usa en la API y se prueba solo; la web formatea con lo mismo |
| fechas | `Intl.DateTimeFormat` con zona IANA | sin librería nueva: conversión pared ↔ UTC en dos pasadas para el cambio de horario |
| web | Next.js App Router + BFF | una página «Agenda» y una pestaña de ajustes |
| colas | BullMQ (ya está) | los recordatorios (segunda entrega) usan el barrido por minuto de seguimientos |

## 2. Esquema

Cinco tablas nuevas, todas con `orgId` y la política `*_tenant_isolation` de siempre.
Horas guardadas en UTC (`TIMESTAMP(3)`, como el resto del esquema); la zona de la
empresa vive en `booking_settings`.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- igualdad + rangos en la misma restricción

booking_settings  (orgId PK→organizations, timezone, slotIntervalMin 30, minNoticeMin 120,
                   maxDays 30, bookedStageId →pipeline_stages SET NULL, blackouts jsonb)
booking_services  (id, orgId, name, description, durationMin, bufferAfterMin, isActive,
                   "order", timestamps)                          index (orgId, isActive)
booking_service_staff (id, orgId, serviceId →CASCADE, userId →CASCADE)  unique (serviceId, userId)
staff_schedules   (id, orgId, userId UNIQUE →CASCADE, hours jsonb (lun..dom: [{from,to}]),
                   blackouts jsonb ([{from,to}] fechas), acceptsBookings bool)
bookings          (id, orgId, serviceId →SET NULL, serviceName (copia), userId →SET NULL,
                   contactId →CASCADE, dealId →SET NULL, conversationId →SET NULL,
                   startAt, endAt, blockEndAt (= endAt + margen), status, source, note,
                   createdById →SET NULL, cancelledAt, cancelReason, timestamps)
  CHECK (endAt > startAt AND blockEndAt >= endAt)
  CHECK (status IN ('CONFIRMED','CANCELLED','COMPLETED','NO_SHOW'))
  CHECK (source IN ('ai','manual','api','link'))
  EXCLUDE USING gist ("userId" WITH =, tsrange("startAt","blockEndAt") WITH &&)
          WHERE (status = 'CONFIRMED')      -- dos citas no se pisan: lo decide la base
  index (orgId, startAt), (userId, startAt), (contactId, startAt)
```

Acceso: RLS de Postgres (capa 2) más la extensión que añade `orgId` en cada consulta
(capa 1); los cinco modelos entran en `TENANT_MODELS`. Probado con el rol `crm_app`.

## 3. API

| método ruta | qué hace | quién | flujo |
| --- | --- | --- | --- |
| GET `/bookings/settings` | zona, intervalo, antelación, etapa de «cita» | equipo | RF01 |
| PUT `/bookings/settings` | guardarlos | ADMIN | RF01 |
| GET `/bookings/services` | servicios con su equipo | equipo | RF01 |
| POST · PATCH · DELETE `/bookings/services[/:id]` | alta, cambio, baja (baja = inactivo si tiene citas) | ADMIN | RF01 |
| GET `/bookings/schedules` | horario de cada persona | equipo | RF01 |
| PUT `/bookings/schedules/:userId` | guardar un horario | ADMIN o la propia persona | RF01 |
| GET `/bookings/slots?serviceId&userId&from&days` | franjas libres | equipo | RF05 |
| GET `/bookings?from&to&userId` | citas de un rango | equipo | RF11 |
| POST `/bookings` | cita a mano | equipo | RF05 |
| PATCH `/bookings/:id` | reprogramar o cambiar estado | equipo | RF06, RF11 |
| POST `/bookings/:id/cancel` | cancelar con motivo | equipo | RF06 |

Herramientas del agente de IA (en `tools.registry.ts`, con valores reales como enum):

| herramienta | tipo | entrada |
| --- | --- | --- |
| `check_availability` | lectura | servicio, persona opcional, día opcional |
| `book_appointment` | acción (aprobación en copiloto) | servicio, inicio «AAAA-MM-DDTHH:mm» en la zona del negocio, persona opcional, nota |
| `reschedule_appointment` | acción | nuevo inicio, cita (si tiene varias) |
| `cancel_appointment` | acción | cita (si tiene varias), motivo |

Eventos internos: `booking.created`, `booking.rescheduled`, `booking.cancelled` (para
flujos y webhooks en la segunda entrega) y una línea `booking` en el historial de la
oportunidad.

Trabajos en segundo plano (segunda entrega): recordatorio «X horas antes» en el barrido
de seguimientos; plantilla con botones Confirmar / Cancelar.

## 4. Lo que muerde

- **Zonas horarias y cambio de horario.** El horario se escribe en hora de pared de la
  empresa; cada franja se pasa a UTC con la zona IANA y dos pasadas (la segunda
  corrige si la primera cae en el salto). Probado con Lima (sin cambio) y Santiago
  (con cambio).
- **Carreras.** Dos clientes, la misma franja: la segunda inserción choca con la
  restricción de exclusión y se responde «esa hora se acaba de ocupar», con otras
  franjas.
- **El agente.** Fechas relativas («mañana a las 10») las resuelve el modelo con la
  fecha y la zona que van en su contexto; la herramienta solo acepta «AAAA-MM-DDTHH:mm»
  y valida contra el motor, nunca confía en el texto.
- **Multiempresa.** Cada tabla con `orgId` + RLS; las herramientas cargan solo los
  servicios y el equipo de la empresa en curso.
- **Ventana de 24 h de WhatsApp.** Confirmar dentro del chat es texto libre; el
  recordatorio del día anterior necesita plantilla (segunda entrega).

## 5. Orden de construcción

1. **Rebanada vertical (esta entrega).** Tablas y migración; motor de franjas con
   pruebas; servicio y rutas; herramientas del agente (ver, reservar, reprogramar,
   cancelar) y sus citas en el contexto; página Agenda (semana, crear, reprogramar,
   cancelar, asistió / no asistió) y pestaña de ajustes (servicios, horario por
   persona, reglas). R01 (mínima), R04, R05, R06, R08, R09; RF01, RF03, RF05, RF06,
   RF07c, RF11.
2. **Avisos.** Confirmación y recordatorio por plantilla con variables de cita
   (fecha, hora, servicio, persona) y botones que actúan sobre la cita; disparadores
   de flujo y webhooks `booking_*`. R12, R13; RF08, RF07b.
3. **Página pública y enlaces.** En el subdominio de la empresa, con límite de
   intentos. R10, R11, R17–R21; RF02, RF04.
4. **Google Calendar, perfil de especialista, tablero y lista masiva, clases con
   capacidad.** R02, R03, R14, R16; RF09, RF10.
