# Recon: Kommo — Reservas (agenda, página de reservas, enlaces y agente de IA)

Fecha: 2026-10-31. Complementa `recon.md` (automatizaciones) y `recon-tablero.md`
(tablero). Aquí, la función de **reservas / citas** de Kommo y cómo se conecta con
el chat, el embudo, el calendario y los recordatorios, frente a lo que ya tiene
Driony.

Método: solo fuentes públicas (landing, centro de ayuda, precios). Sin cuenta de
Kommo, sin iniciar sesión, sin capturas de su app, sin leer su código ni sus APIs
privadas. Como no se usó ninguna cuenta, sus términos sobre «construir un producto
competidor con una cuenta» no aplican. Lo que se replica es el **comportamiento**;
los textos, la marca y las plantillas de Kommo no se copian (las etiquetas de
botones citadas abajo son solo referencia).

## 1. Alcance

| | |
| --- | --- |
| App | Kommo (web; también tiene apps móviles, no revisadas) |
| Parte | Reservas: tipos de reserva (servicios), disponibilidad del equipo, calendario, página pública y enlaces, notificaciones por WhatsApp, agente de IA que agenda, perfiles de calendario, Google Calendar |
| Para quién | Clientes SaaS de Driony: pymes que venden por WhatsApp con cita (clínicas, salones, academias, gimnasios, consultorios) |
| Bucle central | Ver sección 3 |

## 2. Fuentes

| # | fuente | URL | qué aporta |
| --- | --- | --- | --- |
| 1 | Landing «Reserva» (marketing) | https://www.kommo.com/es/reserva/ | Posicionamiento: enlaces, recordatorios, IA que agenda, reserva ligada al CRM, pagos, tareas |
| 2 | Landing agente de IA para reservaciones | https://www.kommo.com/es/ia/agente-de-ia-para-reservaciones/ | Promesas de la IA: reprogramar, varias sesiones, citas como tareas, recurrentes, lista de espera |
| 3 | Precios | https://www.kommo.com/es/buy/tariff/ | Qué plan incluye reservas, página, perfiles de calendario, agentes y créditos |
| 4 | Bookings overview | https://support.kommo.com/docs/bookings-overview.md | Mapa de subfunciones, requisitos por plan, perfiles de calendario |
| 5 | Set up booking types and availability | https://support.kommo.com/docs/bookings-scheduling-setup.md | Campos de tipo de reserva, pestañas, horario, descansos, bloqueos, antelación, intervalo |
| 6 | Manage bookings | https://support.kommo.com/docs/appointment-scheduling-manage.md | Vistas (tablero, lista, calendario), alta manual, reprogramar, cancelar |
| 7 | Set up and manage bookings (guía) | https://support.kommo.com/docs/manage-appointments-and-bookings.md | Etapa sugerida «Appointment completed», avisos internos, qué datos lleva un aviso |
| 8 | Use the booking page | https://support.kommo.com/docs/booking-page-usage.md | Pasos del cliente, confirmación, apariencia, fuente y control de duplicados (actualizado 2026-10-20) |
| 9 | Use booking links | https://support.kommo.com/docs/booking-links-usage.md | Enlace de equipo vs enlace por lead, cómo se insertan en chat, plantillas y Salesbot |
| 10 | Booking page errors | https://support.kommo.com/docs/booking-page-errors.md | Estados de error de la página pública y sus salidas |
| 11 | Team access to bookings | https://support.kommo.com/docs/team-bookings-access.md | Tipo de asiento «Calendar profile», límites |
| 12 | WhatsApp booking notifications | https://support.kommo.com/docs/booking-notifications-whatsapp.md | Confirmación y recordatorio 24 h con plantilla, botones Confirmar / Reprogramar / Cancelar |
| 13 | Automate bookings with the AI agent | https://support.kommo.com/docs/automate-bookings-with-the-ai-agent.md | Acción WHEN / DO / MORE, qué hace el agente, límites |
| 14 | AI agent bookings (variante) | https://support.kommo.com/docs/ai-agent-bookings.md | Ventana de 7 días, resumen en la cita, especialistas homónimos |
| 15 | Tasks & calendar overview | https://support.kommo.com/docs/tasks-calendar-overview.md | Calendario día / semana / mes, tareas vs reservas, avisos |
| 16 | Troubleshooting tasks and bookings | https://support.kommo.com/docs/troubleshooting-tasks.md | Filtros del calendario, sin solapes, solo admins crean reservas |
| 17 | Connect Google Calendar | https://support.kommo.com/docs/google-calendar-connect.md | Sincronía en dos sentidos, un usuario por cuenta de Google |
| 18 | Appointment schedules (Google) | https://support.kommo.com/docs/google-calendar-usage.md | Reservas hechas en Google entran como tarea + lead |
| 19 | Google Calendar + AI agent | https://support.kommo.com/docs/google-calendar-ai-agent.md | Alternativa: la IA solo manda el enlace de Google |
| 20 | Connect Calendly | https://support.kommo.com/docs/connect-calendly-to-kommo.md | Alternativa: Calendly crea lead en «Incoming leads» + tarea |
| 21 | Índice de la documentación | https://support.kommo.com/docs/llms.txt | Lista de artículos de reservas y calendario |

No encontrado: changelog público de reservas, vídeos públicos de la función (las
búsquedas no devolvieron ninguno), ficha de la app móvil (no revisada). La función
parece reciente: la landing la marca como «NUEVO» y la doc de la página pública se
actualizó el 2026-10-20 (fuentes 1 y 8).

## 3. Bucle central

Un cliente pide cita por WhatsApp → el **agente de IA** (o un **enlace de
reservas**) le ofrece horarios libres de un **servicio** y un **especialista** →
se crea la **reserva** en el Calendario, ligada a un **lead** nuevo o existente →
sale una **confirmación** y un **recordatorio 24 h antes** por plantilla de
WhatsApp con botones Confirmar / Reprogramar / Cancelar → el equipo la ve en su
calendario y la atiende.

## 4. Pantallas

Prefijo R para no chocar con las S de `recon.md`. Las pantallas se deducen de la
documentación (no hay capturas); los estados son los que la doc menciona.

| ID | pantalla | cómo se llega | para qué | componentes clave | estados vistos |
| --- | --- | --- | --- | --- | --- |
| R01 | Calendario | menú izquierdo › Calendar | Ver reservas, tareas y eventos de Google por día, semana o mes | vista calendario, bloques de reserva y de tarea, horas libres en blanco y no laborables sombreadas, filtro (All / My / Completed / Deleted events), arrastrar para reprogramar, «+ New event» | vacío, con reservas, filtrado, fuera de horario sombreado |
| R02 | Tablero de reservas | Calendar › vista Board | Seguimiento del día | columnas Overdue / Today / Tomorrow / Next week, tarjetas arrastrables | vacío, con vencidas |
| R03 | Lista de reservas | Calendar › vista List | Gestión masiva | tabla con casillas, acciones masivas: completar, reprogramar, cancelar, borrar | vacío, selección múltiple |
| R04 | Modal «Nuevo evento › Reserva» | R01 › «+ New event» › Booking | Alta manual | buscador de lead con sugerencias + «Crear un lead nuevo», tipo de reserva, día, franja horaria, Guardar | sin franjas, solape rechazado |
| R05 | Reserva en la ficha del lead | clic en la reserva (R01) o desde el chat del lead | Ver, mover o cancelar una reserva concreta | campo fecha y hora editable, «Delete» con confirmación, pestaña Statistics con el enlace de reserva del lead | normal, borrado con aviso de éxito |
| R06 | Ajustes › Tipos de reserva | Calendar › Booking settings | Definir servicios | «+ Add booking type», nombre con lápiz, duración (15 min / 30 min / 1 h / 2 h), margen antes y después, responsable, enlace a su disponibilidad | **vacío** (solo el botón; las pestañas aparecen tras crear el primero), con tipos |
| R07 | Ajustes › Equipo | Booking settings › Team | Quién atiende qué | tabla: responsables, grupos, tipo de asiento, tipos de reserva, disponibilidad, interruptor «Online booking», enlaces | con miembros, miembro oculto de la página |
| R08 | Disponibilidad de un miembro | R07 › nombre › Availability | Horario de cada persona | interruptor por día + rango horario, «+» para otro tramo el mismo día, papelera, interruptor «Break time», «+ Add blackout dates» | por defecto L–V 10:00–19:00 |
| R09 | Ajustes › General | Booking settings › General | Reglas de toda la empresa | días bloqueados de la empresa, antelación mínima, antelación máxima, intervalo de inicio (5 / 15 / 30 / 45 / 60 min) | — |
| R10 | Ajustes › Página de reservas | Booking settings › Booking page | Activar la página y enrutar leads | «Booking source & lead routing» (embudo), control de duplicados (3 opciones), enlace con copiar y vista previa, papelera para quitar la fuente | activa, **desactivada** (sin embudo) |
| R11 | Apariencia de la página | R10 › Appearance | Marca del negocio en la página | logo (JPG/PNG ≤ 2 MB), banner (≤ 5 MB, 16:9), tema predefinido o HEX propio con ajuste automático de contraste, nombre (≤ 100), resumen (≤ 500), dirección, teléfono, email, enlaces web / WhatsApp / Instagram / Facebook / TikTok, vista previa móvil / escritorio | por defecto, personalizada |
| R12 | Ajustes › Automatización | Booking settings › Automation | Avisos al cliente | «Send from» (número de WhatsApp), interruptores Confirmación y Recordatorio 24 h, estado de la plantilla (Pending / Approved / Rejected con motivo al pasar el ratón), sección Bots (Salesbot) | apagado, pendiente, aprobado, rechazado |
| R13 | Modal de plantilla de aviso | R12 › interruptor | Crear o elegir la plantilla | nombre, idioma, categoría, cuerpo prellenado, ejemplos de variables, botones Confirmar / Reprogramar / Cancelar (cada uno con texto y respuesta), «Send for approval» | nueva, existente aprobada |
| R14 | Alta de usuario con perfil de calendario | Settings › User management › «+ Add user» | Especialistas con acceso limitado | nombre, email, contraseña, grupo, tipo de asiento «Calendar profile»; modal de límite con «Request profile» / «Save as inactive» | dentro del cupo, cupo lleno |
| R15 | Agente de IA › acción de reserva | AI agent › Actions › «+ Add action» | Que la IA agende | WHEN («Client wants to: book» o condición propia), DO «Create booking in Calendar», servicios (varios), MORE (instrucciones), Test mode | sin servicios, en prueba, activo |
| R16 | Integración Google Calendar | Settings › Integration marketplace › Google Calendar | Sincronía con Google | «Continue with Google», usuario de Kommo destino, campo del lead para la fecha (opcional), Log out; en Calendar › Sync el estado Active | conectado, inactivo |
| R17 | Página pública: especialista y servicio | enlace de reservas | El cliente elige qué y con quién | cabecera con logo, banner y datos, tarjetas de especialista y de servicio (el orden depende de la configuración) | disponible, «Not available» |
| R18 | Página pública: fecha y hora | R17 › siguiente | Elegir franja | calendario mensual, lista de franjas, lápiz para cambiar servicio o especialista | con franjas, **sin franjas** (sugiere la próxima fecha libre) |
| R19 | Página pública: datos | R18 › franja | Identificarse | nombre (opcional), teléfono (obligatorio, con prefijo de país válido), CAPTCHA, «Confirm booking» | válido, teléfono inválido, franja tomada, especialista o servicio ya no disponible, fallo al confirmar |
| R20 | Página pública: confirmación | R19 › confirmar | Cerrar y autogestionar | resumen (servicio, especialista, fecha y hora), Añadir a Google Calendar, Reprogramar, Cancelar, Reservar otra hora | confirmada |
| R21 | Página pública: no disponible | enlace roto o desactivado | Explicar | mensaje «no disponible, inténtalo más tarde» | — |
| R22 | Composer del chat con enlace | chat del lead › escribir «boo…» | Mandar el enlace a mano | sugerencias de enlace en el campo de mensaje; en plantillas de chat y en Salesbot, marcador «[boo…» | — |
| R23 | Chat de WhatsApp del cliente | lado del cliente | Agendar sin salir del chat | mensajes del agente con servicios y horarios, plantilla con botones Confirmar / Reprogramar / Cancelar | en curso, confirmada, cancelada |

## 5. Flujos

```
RF01 Admin activa las reservas por primera vez
     R01 → Booking settings → R06 (+ tipo: nombre, duración, márgenes, responsable, guardar)
     → R07 → R08 (horario de cada persona) → R09 (bloqueos, antelación, intervalo)
     → R10 (asignar embudo) → R11 (apariencia) → R12 (avisos por WhatsApp)
     happy path: unos 20 clics para un servicio y una persona
     edge: sin tipo de reserva la página no existe; sin embudo la página se abre pero no
           deja reservar; en planes sin página/enlaces solo queda la agenda interna

RF02 Cliente nuevo reserva por el enlace
     enlace en WhatsApp/redes → R17 especialista → servicio → R18 fecha → hora → R19 teléfono
     → CAPTCHA → confirmar → R20
     happy path: 7 interacciones
     edge: franja tomada mientras rellena («elige otra hora»), especialista o servicio que deja
           de estar disponible, día sin franjas (propone la próxima fecha), teléfono sin prefijo,
           control de duplicados: lead nuevo o se suma al último activo / cerrado
     resultado: reserva en el Calendario + lead en la etapa «Incoming leads» del embudo asignado

RF03 Cliente reserva hablando con el agente de IA
     «quiero una cita» → agente pregunta servicio (si hay varios) → especialista (o «cualquiera»)
     → ofrece fechas y horas (o la más próxima) → repite servicio, fecha y hora → cliente confirma
     → reserva creada con resumen de la conversación
     happy path: 3–4 mensajes del cliente
     edge: un solo especialista libre (lo asigna y lo dice), franja ocupada mientras tanto
           (propone otras), cambia de servicio a mitad (pide confirmación si pierde avance),
           4 mensajes fuera de tema → recordatorio, 5 → abandona la reserva, una reserva a la vez,
           sin créditos de IA el agente deja de responder

RF04 Vendedor manda el enlace desde el chat
     ficha del lead → R22 escribir «boo…» → elegir enlace → enviar
     variante: enlace del lead (pestaña Statistics) para que la reserva quede en el mismo lead
     happy path: 3 clics

RF05 Equipo crea una reserva a mano
     R01 → «+ New event» → Booking → R04 lead (o crear) → tipo → día → franja → guardar
     happy path: 6 clics
     edge: solape con otra reserva (no se permite; con tareas sí), solo admins pueden

RF06 Equipo reprograma o cancela
     R01 clic → ficha → reserva → campo fecha → nueva franja → guardar   (o arrastrar en R01)
     cancelar = «Delete» + confirmar (desaparece del lead y del calendario); masivo en R03
     happy path: 4–5 clics

RF07 Cliente reprograma o cancela solo
     a) desde R20 o desde el evento añadido a su Google Calendar (lleva el enlace)
     b) botón Reprogramar / Cancelar del recordatorio de WhatsApp
     c) pidiéndoselo al agente: lista sus citas de los próximos 7 días (máx. 10), elige,
        nueva hora, confirma; el especialista no se puede cambiar (cancelar y reservar)

RF08 Confirmación y recordatorio 24 h por WhatsApp
     R12 → Send from → interruptor → R13 plantilla nueva o aprobada → Send for approval → guardar
     → Meta aprueba → Kommo crea y activa un bot (no editable) que envía al crear y 24 h antes
     edge: plantilla rechazada (ver motivo, editar, reenviar), duplicados si ya había un
           Salesbot de avisos, cambiar de número obliga a rehacer plantillas

RF09 Especialista con perfil de calendario
     admin: R14 asiento «Calendar profile» → especialista entra, ve su agenda, los datos y notas
     de los leads de sus citas, conecta su Google Calendar; no escribe a clientes ni edita leads

RF10 Conectar Google Calendar
     R16 → Continue with Google → cuenta → usuario de Kommo → guardar
     → eventos y tareas en los dos sentidos (solo lo creado después de conectar)

RF11 Atender el día
     R02 (vencidas / hoy / mañana / semana) → atender → marcar completada (R03)
     → mover el lead a «Appointment completed» (a mano o por automatización: no documentado)
```

## 6. Componentes

| componente | variantes | estados | pantallas |
| --- | --- | --- | --- |
| Vista calendario | día, semana, mes | libre (blanco), no laborable (sombreado), con bloques, arrastre | R01 |
| Bloque de evento | reserva, tarea, evento de Google | normal, completada, borrada (por filtro) | R01 |
| Tarjeta de reserva | en tablero | normal, vencida, arrastre | R02 |
| Tabla con selección múltiple | lista de reservas | vacía, selección, acción masiva en curso | R03, R07 |
| Selector de lead | buscar existente, «crear lead nuevo» | sugerencias, sin resultados | R04 |
| Selector de franjas | rejilla por intervalo | libre, ocupada, seleccionada, sin franjas | R04, R18 |
| Calendario mensual (date picker) | — | día con franjas, sin franjas, fuera de antelación | R18 |
| Editor de horario semanal | por día: interruptor + tramos («+», papelera) + descanso | cerrado, un tramo, varios tramos | R08 |
| Selector de días bloqueados | rango de fechas, «Done» | vacío, con rangos | R08, R09 |
| Desplegables de duración / margen / antelación / intervalo | valores fijos | — | R06, R09 |
| Interruptor | reserva online, aviso confirmación, aviso 24 h | on, off | R07, R12 |
| Copiar enlace | enlace de equipo, enlace del lead | copiado | R10, R05 |
| Insignia de estado de plantilla | Pending, Approved, Rejected (tooltip con motivo) | — | R12 |
| Editor de plantilla con botones | Confirmar, Reprogramar, Cancelar (texto + respuesta) | nueva, aprobada | R13 |
| Constructor de acción de IA | WHEN / DO / MORE | sin servicios, en prueba | R15 |
| Subida de imagen | logo, banner | límite de tamaño | R11 |
| Selector de tema | predefinido, HEX propio (ajuste de contraste) | — | R11 |
| Vista previa | móvil, escritorio | — | R11 |
| Tarjeta de opción pública | especialista, servicio | disponible, «Not available», seleccionada | R17 |
| Campo de teléfono con prefijo de país | — | válido, inválido | R19 |
| CAPTCHA | — | pendiente, resuelto | R19 |
| Pantalla de resultado | confirmación con acciones, error con salida («elige otra hora / otro especialista / otro servicio»), no disponible | — | R20, R19, R21 |
| Sugerencias en el composer | enlaces de reserva | — | R22 |
| Diálogo de confirmación | borrar reserva | — | R05 |
| Aviso (toast) | éxito al borrar o guardar | — | R05, R06 |

## 7. Modelo de datos inferido

```
BookingType (servicio)
            id, name, duration_min (15 | 30 | 60 | 120), buffer_before_min, buffer_after_min,
            responsible_user_ids[] (al menos uno)
            evidencia: R06, fuentes 5 y 13 («at least one responsible user»). Confianza: alta
            (la lista de duraciones es la del desplegable; no se ve duración libre)

Availability (por usuario)
            user_id, days { mon..sun: [ {from, to} ... ] | null }, break {from, to}?,
            blackout_dates [ {from, to} ], online_booking (bool, aparece en la página)
            evidencia: R07, R08, fuente 5 (por defecto L–V 10–19). Confianza: alta

BookingSettings (empresa)
            blackout_dates[], min_notice, max_notice, slot_interval_min (5|15|30|45|60),
            pipeline_id (fuente «Booking page»), duplicate_mode (always_new | latest_active |
            latest_closed), appearance { logo, banner, theme | accent_hex, business_name,
            summary, address, phone, email, links { web, whatsapp, instagram, facebook, tiktok } }
            evidencia: R09, R10, R11, fuentes 5 y 8. Confianza: alta

Booking     id, booking_type_id, responsible_user_id, lead_id, start_at, end_at,
            status (scheduled | completed | deleted), source (manual | page | team_link |
            lead_link | ai_agent), ai_summary, created_by
            evidencia: R04, R05, filtros Completed / Deleted (fuente 16), resumen de la IA
            (fuente 14). Confianza: media. Cancelar = borrar (botón «Delete»); que sea borrado
            lógico es SUPOSICIÓN por el filtro «Deleted events». Sin estado «no asistió».
            Regla: dos reservas no se solapan (por responsable, se supone); tareas sí pueden.

BookingLink kind (team | lead), lead_id?, token
            evidencia: fuente 9. Confianza: media (la forma de la URL no está documentada)

User.seat_type   full | calendar_profile   (10 gratis en Pro / Enterprise; más, por soporte)
            evidencia: R14, fuente 11. Confianza: alta

BookingNotification
            channel_id (número de WhatsApp), kind (confirmation | reminder_24h), template_id,
            enabled, generated_bot_id (no editable)
            evidencia: R12, R13, fuente 12. Confianza: alta

TemplateButton (en la plantilla de aviso)
            action (confirm → nota en el lead | reschedule | cancel), label, response_text
            evidencia: fuente 12. Confianza: alta

AiAgentAction
            when (intent «book» | condición), do = create_booking, service_ids[], more (texto)
            evidencia: R15, fuente 13. Confianza: alta

CalendarSync (Google)
            google_account, kommo_user_id, status (active | inactive), lead_date_field_id?,
            external_event_id en reservas y tareas (SUPOSICIÓN)
            evidencia: R16, fuentes 17 y 18. Confianza: media

Task        (ya existe en Kommo; lo que entra de Google o Calendly se convierte en tarea)
            evidencia: fuentes 15, 18, 20. Confianza: alta
```

Relaciones: Empresa 1-n BookingType; BookingType n-n User (responsables); User 1-1
Availability; Lead 1-n Booking; BookingType 1-n Booking; User 1-n Booking; Pipeline
1-1 fuente «Booking page» (los leads nuevos entran en «Incoming leads»); Lead 1-1
BookingLink de lead.

**No documentado (incierto):** zonas horarias (ninguna fuente las menciona), idioma
de la página, capacidad > 1 (clases grupales), recursos físicos (salas, sillones),
precio por servicio (solo como conocimiento de la IA), preguntas propias en el
formulario (solo en Google), avisos al cliente por email, estado «no asistió»,
pagos o adelantos al reservar (la landing dice «Automatiza las solicitudes de
pago», fuente 1, sin doc; posiblemente vía sus integraciones de Stripe / Mercado
Pago), y las promesas de la landing de IA sobre **varias sesiones, citas
recurrentes y lista de espera** (fuente 2), que la doc del agente contradice en
parte («una reserva a la vez, un servicio por reserva», fuente 13). Tratar esas
promesas como marketing hasta verlas en la doc.

## 8. Planes en Kommo (qué gatean)

| función | plan | fuente |
| --- | --- | --- |
| Reservas y agenda internas | Todos los planes según la ayuda; la página de precios la lista en Pro («Gestión de citas y reservas»). **Contradicción**: tomar Pro como lo seguro | 4, 3 |
| Página y enlaces de reservas | Pro, Enterprise, prueba | 8, 9 |
| Perfiles de calendario | Pro, Enterprise (10 gratis) | 11, 3 |
| Avisos por WhatsApp automáticos / con Salesbot | Avanzado o superior | 12, 6 |
| Agente de IA que agenda | Pro, Enterprise nuevo, prueba; consume créditos de IA | 13, 3 |
| Google Calendar | Todos | 17 |
| Precio | Básico 20, Avanzado 30, Pro 45 USD por usuario y mes; mínimo 6 meses | 3 |

Lectura: Kommo pone lo que Driony más quiere ofrecer (agendar por WhatsApp con
IA y la página de reservas) en su plan de 45 USD por usuario. Para una pyme de
3 personas son 135 USD al mes como mínimo.

## 9. Qué tiene Driony hoy y qué falta

Driony **no tiene módulo de reservas ni calendario**: no hay entidad de cita, ni
de tarea, ni librería de fechas en la web. Pero ya tiene casi todas las piezas
alrededor: el objetivo «agendar» en el asistente de configuración del agente
(`apps/web/src/features/bots/AgentSetupWizard.tsx`,
`apps/api/src/modules/ai/business-setup.rules.ts`), plantillas de negocio con la
etapa «Cita agendada» para salud y belleza
(`packages/shared/src/schemas/business-setup.schema.ts`), herramientas del agente
con esquema dinámico y aprobación en copiloto, flujos con disparadores por evento,
plantillas de Meta con botones, y un barrido por minuto para seguimientos.

| # | función de Kommo | Driony hoy | estado | qué se reutiliza |
| --- | --- | --- | --- | --- |
| 1 | Servicios reservables (duración, márgenes, responsables) | Catálogo de productos con precio y moneda, sin duración | falta | `Product` en `apps/api/prisma/schema.prisma` para precio; nueva entidad de servicio |
| 2 | Horario por persona (varios tramos, descanso, días bloqueados) | Horario del agente: zona + **un** rango por día | parcial | `businessHoursSchema` en `packages/shared/src/schemas/agent-config.schema.ts`; `isWithinHours` en `apps/api/src/common/utils/business-hours.ts` |
| 3 | Antelación mínima / máxima, intervalo de inicio | — | falta | — |
| 4 | Zona horaria | Solo en el horario de cada agente (por defecto America/Lima); la empresa no tiene zona | parcial | lo mismo que 2; país del contacto por prefijo (`packages/shared/src/phone.ts`) |
| 5 | Calendario día / semana / mes | — | falta | sistema de diseño (DESIGN.md); sin librería de fechas en `apps/web` |
| 6 | Tablero (vencidas / hoy / mañana / semana) y lista con acciones masivas | Tablero del embudo con arrastrar | falta | patrones de `apps/web/src/features/pipeline/` |
| 7 | Alta manual desde el chat o la ficha | Ficha lateral de la oportunidad, chat | falta | `apps/web/src/features/inbox/ChatWindow.tsx`, ficha del embudo |
| 8 | Sin dobles reservas | — | falta | restricción de exclusión en Postgres (nueva) |
| 9 | La reserva crea o reutiliza el lead y lo pone en una etapa | Alta de leads con unión por variantes de teléfono; decidir crear / reabrir / saltar; mover de etapa | parcial | `LeadService.ingestLead` en `apps/api/src/modules/leads/lead.service.ts`; `decideIntake` en `apps/api/src/modules/pipeline/intake.ts`; `moveDeal` / `markLead` en `apps/api/src/modules/ai/agent-actions.service.ts` |
| 10 | Historial de la reserva en el lead | Historial de la oportunidad | parcial | `DealEvent` (nuevos `kind`: booking_created / rescheduled / cancelled) |
| 11 | Página pública de reservas | Subdominio por empresa; endpoints públicos con token | falta | `apps/web/src/middleware.ts` (slug), `apps/api/src/modules/leads/lead-webhook.controller.ts` y `stage-webhook.controller.ts` como patrón de ruta pública |
| 12 | Enlace de equipo y enlace por lead | — | falta | token firmado con `contactId` / `dealId` |
| 13 | Apariencia (logo, banner, color, datos, redes) | Almacenamiento de archivos | falta | `apps/api/src/infra/storage/` |
| 14 | CAPTCHA y límite de intentos en la página | Límite de intentos solo en el login | parcial | `assertNotThrottled` en `apps/api/src/modules/auth/auth.service.ts` |
| 15 | El agente de IA ve horarios, reserva, reprograma y cancela | Herramientas con enums reales del workspace; acciones con aprobación en copiloto; objetivo «agendar» sin herramienta de agenda | parcial (base lista, falta la agenda) | `apps/api/src/modules/ai/tools.registry.ts` (nueva lectura `check_availability`, acciones `book_appointment`, `reschedule_appointment`, `cancel_appointment`), `agent-actions.service.ts` (`dispatch`), `AgentSetupWizard.tsx` (herramientas del objetivo «agendar») |
| 16 | Resumen de la conversación en la cita | Memoria del cliente | parcial | `Contact.aiMemory` |
| 17 | Bloque de flujo para mandar el enlace o reservar | 16 tipos de bloque, botones (máx. 3) | falta | `packages/shared/src/schemas/flow.schema.ts` (`flowNodeTypes`), `apps/api/src/modules/ai/flow-engine.service.ts` |
| 18 | Disparadores «reserva creada / cancelada» | 11 disparadores por evento | falta | `flowTriggerTypes` en `flow.schema.ts`; `apps/api/src/modules/ai/flow-triggers.service.ts` (`@OnEvent`) |
| 19 | Recordatorio X horas antes de la cita | Seguimientos por silencio del cliente con barrido por minuto; esperas en cola | parcial (mecanismo sí, disparador no) | `apps/api/src/modules/ai/follow-up.service.ts` (barrido), `QUEUE_FLOW` en `apps/api/src/infra/queue/queue.constants.ts` |
| 20 | Confirmación y recordatorio con plantilla aprobada | Plantillas de Meta: alta, aprobación, sincronía, motivo de rechazo; relleno de variables solo fijo / nombre / teléfono | parcial | `apps/api/src/modules/campaigns/template.service.ts`, `meta-template.client.ts`, `template-fill.service.ts`; `variableSources` en `packages/shared/src/schemas/template.schema.ts` (añadir fecha, hora, servicio, especialista, dirección, enlace) |
| 21 | Botones Confirmar / Reprogramar / Cancelar que actúan sobre la cita | Botones QUICK_REPLY en plantillas; la respuesta de botón entrante ya se lee | parcial | `template.schema.ts` (botones), `apps/api/src/modules/whatsapp/webhook.types.ts` (`button_reply`, `list_reply`) |
| 22 | Elegir horario en el chat con lista | Solo botones de respuesta (máx. 3); la lista entrante se lee pero no se envía | parcial | `sendInteractiveButtons` en `apps/api/src/modules/whatsapp/whatsapp-provider.interface.ts` (falta `sendInteractiveList`) |
| 23 | Avisos internos al responsable (nueva cita, antes de empezar) | Tiempo real en el panel; tokens de push guardados | parcial | `apps/api/src/modules/realtime/`, modelo `Device` (pushToken) |
| 24 | Perfil de calendario (especialista con acceso limitado) | Permisos por usuario: alcance, secciones, acciones | parcial | `packages/shared/src/permissions.ts` (nueva sección «agenda» y alcance «mis citas») |
| 25 | Google Calendar en dos sentidos | Sin OAuth de Google | falta | `IntegrationSetting` para credenciales cifradas (`secret-box.ts`) |
| 26 | Calendly / Cal.com | Webhook de leads entrantes | parcial | `lead-webhook.controller.ts` (crea el lead, no la cita) |
| 27 | Tareas junto a las reservas | — | falta | (ya señalado en `recon-tablero.md`) |
| 28 | Webhooks salientes de reservas | Webhooks salientes de mensajes, contactos y oportunidades | parcial | `webhookEvents` en `packages/shared/src/schemas/webhook-out.schema.ts` |
| 29 | API pública de reservas | API pública | parcial | `apps/api/src/modules/public-api/` |
| 30 | Gating por plan | Funciones por plan | parcial | `PLAN_FEATURES` en `packages/shared/src/plans.ts` (añadir `bookings`) |
| 31 | Pagos o adelanto al reservar | La plantilla de belleza ya sugiere «50 % de adelanto por transferencia»; pasar a humano cuando llega un comprobante | parcial (manual) | `escalationRules.onMedia` en `agent-config.schema.ts` |

Donde Driony puede ir **por delante** (Kommo no lo documenta): estado «asistió /
no asistió» ligado a las etapas «Atendido» / «Perdido» que ya traen las plantillas
de negocio; recordatorio configurable (no solo 24 h) y un segundo toque el mismo
día; **capacidad > 1** para clases de academias y gimnasios; zona horaria visible
en la página; todo en el plan de entrada en vez de en el de 45 USD.

### MVP propuesto (rebanada fina), en orden de construcción

Primero por el chat, porque los clientes de Driony viven en WhatsApp y la IA
ya está ahí. La página pública va en la segunda rebanada.

1. **Datos.** Zona horaria en la empresa; `BookingService` (nombre, duración,
   margen después, precio opcional o `productId`, activo, responsables);
   disponibilidad por usuario (varios tramos por día + días bloqueados, en JSON,
   ampliando la forma de `businessHoursSchema`); `Booking` (servicio, usuario,
   contacto, oportunidad, `startAt` / `endAt` en UTC, estado `confirmed |
   cancelled | completed | no_show`, origen, nota, resumen de la IA) con
   restricción de exclusión por usuario para que no haya solapes. RLS como el
   resto (probar con el rol `crm_app`) y migración escrita a mano, no
   `migrate dev`.
2. **Motor de franjas** como función pura y probada (igual que `intake.ts`):
   tramos − bloqueos − citas con margen, filtrado por antelación mínima y máxima,
   en la zona de la empresa.
3. **Herramientas del agente**: `check_availability` (lectura) y
   `book_appointment` / `cancel_appointment` / `reschedule_appointment`
   (acciones, con aprobación en copiloto). Al reservar: crea o reutiliza la
   oportunidad (`decideIntake`), la mueve a la etapa de cita (un rol nuevo de
   etapa, como `isQualified`), apunta un `DealEvent` y la conversación queda en
   la memoria. Activarlas por defecto en el objetivo «agendar».
4. **Pantalla Agenda mínima**: lista por día y semana simple, con crear,
   mover y cancelar a mano (también desde la ficha y el chat). Ajustes:
   servicios y horario por persona.
5. **Confirmación y recordatorio por plantilla**: variables de cita en
   `variableSources`; recordatorio «X horas antes» con el barrido de
   `follow-up.service.ts`; botones Confirmar / Cancelar que actúan sobre la cita
   al llegar el `button_reply`.
6. **Eventos**: disparadores de flujo `booking_created` / `booking_cancelled` y
   los mismos como webhooks salientes.

Segunda rebanada: página pública en el subdominio de la empresa, enlace de equipo
y por lead, apariencia, CAPTCHA y límite de intentos, lista interactiva de
WhatsApp para elegir horario. Tercera: Google Calendar (ocupado → bloquea; cita →
evento), perfil de especialista, tablero y lista con acciones masivas, clases
con capacidad, adelantos.

### Matriz de funciones

Ver `features-reserva.csv` (77 filas): must 27, should 31, could 13, skip 6. La
columna `clone` refleja el estado actual de Driony, como en `features.csv`:
no 51, partial 20, yes 0.

## 10. Lo que no se replica

| qué | por qué |
| --- | --- |
| Textos, plantillas de aviso, temas y marca de Kommo | Son suyos; Driony escribe los propios |
| Créditos y paquetes de IA de Kommo | Modelo comercial suyo; Driony ya tiene su consumo por plan |
| Cupo «10 perfiles gratis» y «pedir más a soporte» | Decisión comercial, no una función |
| Appointment schedules de Google y Calendly / Cal.com como producto | Son de terceros: se integran por su API oficial, no se clonan |
| Chat interno del equipo (Team Chat) | Fuera del alcance de reservas |
| Promesas sin documentar (lista de espera, recurrentes, varias sesiones) | No hay evidencia de cómo funcionan; decidir por necesidad propia, no por paridad |

## 11. Tamaño

- Pantallas: 23 (R01–R23), 6 de ellas del lado del cliente (R17–R21 y R23).
- Flujos: 11 (RF01–RF11). Clics del camino feliz a batir: 7 en la página
  (RF02); por chat con IA, 3–4 mensajes (RF03). Meta para Driony: 2 toques en
  WhatsApp (elegir horario en una lista y confirmar).
- Entidades: unas 10 en Kommo; el MVP de Driony necesita 3 nuevas (servicio,
  disponibilidad, cita) y campos en empresa, etapa y plantillas.
- Partes difíciles:
  1. **Motor de disponibilidad sin dobles reservas**: zonas horarias, márgenes,
     antelación, y concurrencia (dos clientes, misma franja) resuelta en la base
     con una restricción de exclusión, no en la app.
  2. **Agente que agenda de forma fiable**: estado de varios turnos, confirmar
     antes de escribir, franja que se ocupa mientras habla, cambios de idea, y
     la regla de las 24 h de WhatsApp para los recordatorios (plantilla
     aprobada por número).
  3. **Google Calendar en dos sentidos**: OAuth, canales de notificación que
     caducan, ediciones y borrados en ambos lados, y qué manda si chocan.
- Tamaño: MVP (pasos 1–6) **M**, unas 2–3 semanas. Paridad con Kommo (página,
  enlaces, Google, perfiles, tablero y lista) otro **M**; con clases y pagos,
  **L**.

Siguiente paso: `/replica-architect` con este archivo para pasar el modelo a
esquema Prisma y el orden de rutas, empezando por los pasos 1–3 del MVP.
