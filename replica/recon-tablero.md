# Recon: Kommo — el embudo en el día a día (tablero, ficha, filtros, cierre)

Fecha: 2026-10-26. Complementa `recon.md` (automatizaciones). Aquí, lo que un
vendedor usa a diario en el embudo de Kommo, frente a lo que ya tiene Driony.
Solo fuentes públicas; la documentación nueva de Kommo es escasa en el uso del
tablero, así que algunas filas se apoyan en sus páginas antiguas (marcadas).

## Fuentes

| fuente | URL |
| --- | --- |
| Uso del embudo | https://support.kommo.com/docs/pipeline-usage.md |
| Mover leads, Won / Lost | https://support.kommo.com/docs/move-leads-through-pipeline-stages.md |
| Filtros y búsqueda | https://support.kommo.com/docs/filter-search.md |
| Edición masiva | https://support.kommo.com/docs/edit-your-leads-in-bulk.md |
| Tareas | https://support.kommo.com/docs/create-assign-tasks.md |
| Win-Loss | https://support.kommo.com/docs/win-loss-statistics.md |
| Control de duplicados | https://support.kommo.com/docs/set-up-duplicate-control.md |
| Productos en el lead | https://support.kommo.com/docs/link-products-to-leads.md |
| Leads entrantes (página antigua, 2020) | https://www.kommo.com/support/crm/incoming-leads/ |
| Puntuación | https://support.kommo.com/docs/lead-scoring.md |

## Lo que Kommo hace en el tablero

- **Vista tablero y vista lista** (icono junto a la búsqueda), con casillas para seleccionar.
- **Selección múltiple** («Select multiple») y acciones masivas: cambiar responsable, añadir tareas, cambiar etapa, borrar, editar etiquetas.
- **Ganado / Perdido** apareciendo abajo al arrastrar una tarjeta; al soltar, el lead sale del embudo y cuenta en estadísticas.
- **Leads entrantes**: etapa gris con aceptar (✓), rechazar (papelera) y unir con uno existente (cadena).
- **Búsqueda global** (leads, contactos, empresas) con atajos de teclado; **filtros predefinidos** (p. ej. «con tareas vencidas») y personalizados (responsable, etapa, fecha de creación…).
- **Tareas** por lead: tipo (Seguimiento, Reunión, propios), vencimiento («En una hora», «Hoy», «Mañana», fecha y hora), responsable y comentario; también desde el calendario.
- **Productos en el lead** con cantidad: el valor de venta se calcula solo.
- **Duplicados**: unión automática por teléfono o email al entrar; buscar y unir a mano.
- **Win-Loss**: por etapa (dentro, entraron, perdidos), ciclo de vida medio, tiempo de atención de entrantes, previsión de ventas.
- **Puntuación** junto a la etapa en la ficha; **colores** por etapa; **campos propios por embudo**.

## Lo que ya tiene Driony

Varios embudos en pestañas; búsqueda por título, nombre o teléfono; filtros por
etiquetas, fuente, vendedor, fecha (creación o último mensaje), rango de valor
y «esperando respuesta»; por etapa, el número y el total por moneda, con
insignias de automatizaciones y conversiones; tarjeta con título, contacto,
botón al chat con no leídos, hasta 3 etiquetas, fuente, valor, vendedor y
estado del chat; arrastrar y soltar; alta rápida; ficha lateral con título,
valor y moneda, etapa, vendedor, etiquetas, campos del contacto, llamar, y
botones Ganado / Perdido / Descartar; lista de descartadas con restaurar;
etapa de entrantes con descarte automático; panel con tasa de cierre y embudo.

## Lo que le falta a Driony, por impacto

1. **Selección múltiple y acciones masivas**: mover de etapa, cambiar vendedor, etiquetar, descartar y **lanzar un flujo** a muchas a la vez.
2. **Zonas Ganado / Perdido / Descartar al arrastrar**: hoy solo están en la ficha.
3. **Motivo de pérdida**: al marcar Perdido, elegir un motivo de una lista editable, y verlo en el panel. Kommo no lo documenta: aquí Driony puede ir por delante.
4. **Tareas** con vencimiento y aviso en la tarjeta (sin tarea, vence hoy, vencida). Es la pieza más grande.
5. **Historial de la oportunidad**: quién la movió, cuándo y por qué (IA, flujo, persona), y **tiempo en la etapa** visible en la tarjeta.
6. **Vista lista** con columnas ordenables y exportar a CSV.
7. **Filtros guardados** («Mis oportunidades», «Sin vendedor», «Más de 7 días en la etapa»).
8. **Productos en la oportunidad** con cantidad y valor calculado, usando el catálogo que ya existe.
9. **Colores por etapa**, **campos propios de oportunidad** y **unir contactos duplicados**.
10. **Informe por etapa**: cuántas entraron, cuántas se perdieron en cada una y tiempo medio.

## Lo que no se replica

| qué | por qué |
| --- | --- |
| Empresas (companies) | Driony es B2C por WhatsApp; puede venir después |
| Duplicados por «Big Data» y píxel | Son datos propios de Kommo |
| Previsión de ventas por aprendizaje automático | Necesita historial grande; mejor una previsión simple primero |

## Tamaño

Puntos 1, 2, 3 y 5: **S/M** (días), porque se apoyan en lo que ya existe. Punto
4 (tareas) y 6 (vista lista): **M**. El resto: **M** entre todos.
