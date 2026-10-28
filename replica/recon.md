# Recon: Kommo — embudos, Digital Pipeline y Salesbot

Fecha: 2026-10-26. Alcance acotado: solo embudos (pipelines), automatizaciones por
etapa (Digital Pipeline) y flujos (Salesbot). Objetivo: ver qué tiene Kommo que
Driony todavía no tiene, para replicar el **comportamiento** (no código, textos
ni marca de Kommo).

Fuentes: solo la documentación pública de Kommo. Sin cuenta de Kommo, sin
capturas de su app y sin leer su código ni sus APIs privadas.

## 1. Alcance

| | |
| --- | --- |
| App | Kommo (web) |
| Parte | Embudos + Digital Pipeline (disparadores por etapa) + Salesbot (constructor de flujos) |
| Para quién | Driony: CRM de WhatsApp con IA para pymes de LatAm |
| Bucle central | Un lead entra a una etapa → una automatización actúa sola (bot, tarea, mensaje, cambio de etapa) → el lead avanza o se le hace seguimiento |

## 2. Fuentes

| fuente | URL | qué aporta |
| --- | --- | --- |
| Disparadores del Digital Pipeline | https://support.kommo.com/docs/set-up-digital-pipeline-triggers.md | Las 12 acciones por etapa y sus opciones |
| Disparadores del Salesbot | https://support.kommo.com/docs/salesbot-triggers-overview.md | Todas las reglas de ejecución y filtros |
| Configurar disparadores | https://support.kommo.com/docs/configure-your-salesbot-triggers.md | Límites del constructor |
| Pasos del Salesbot | https://support.kommo.com/docs/salesbot-overview.md | Tipos de paso, acciones, pausas, validaciones |
| Crear un Salesbot | https://support.kommo.com/docs/create-a-salesbot-in-kommo.md | Editor visual, vista previa, modo código |
| Automatizar el embudo | https://support.kommo.com/docs/automate-pipeline-actions.md | Etapa de entrantes, puntuación, mover y duplicar disparadores |
| Embudos | https://support.kommo.com/docs/pipelines-overview.md | Varios embudos, etapas con color, ganado y perdido |
| Mover leads | https://support.kommo.com/docs/move-leads-through-pipeline-stages.md | Arrastrar a «Won» / «Lost» abajo |
| Puntuación de leads | https://support.kommo.com/docs/lead-scoring.md | Fórmula por etapa, UTM y campos |
| Índice de la documentación | https://support.kommo.com/docs/llms.txt | Mapa de artículos |

## 3. Pantallas

| ID | pantalla | cómo se llega | para qué | componentes clave | estados |
| --- | --- | --- | --- | --- | --- |
| S01 | Embudo (kanban) | Leads | Ver y mover leads por etapa | columnas con color, tarjetas, totales por etapa, zonas «Won»/«Lost» al arrastrar | vacío, con leads, filtrado |
| S02 | Editar etapas | Leads › Settings | Crear, renombrar, ordenar y colorear etapas | lista ordenable, selector de color | — |
| S03 | Digital Pipeline | Leads › Automate | Disparadores debajo de cada etapa | rejilla etapa × disparadores, botón «+», mover y duplicar disparadores | sin disparadores, con varios, «+n» con más de 20 |
| S04 | Configurar disparador | clic en «+» de una etapa | Elegir acción, condiciones y cuándo se ejecuta | selector de acción, filtros, regla de ejecución, horario activo, «aplicar a los leads que ya están en la etapa» | guardado, error al guardar |
| S05 | Constructor del Salesbot | Automate › Salesbot | Diseñar el flujo paso a paso | lienzo, pasos numerados, conexiones, menú por paso, vista previa, modo código | nuevo, editado, desactivado |
| S06 | Vista previa del bot | botón Preview | Probar el flujo | simulación de chat con botones y listas | — |
| S07 | Disparadores del bot | Salesbot › Triggers | Cuándo arranca el bot | categorías: embudo, programado, comportamiento, conversación | — |
| S08 | Puntuación de leads | Leads › Settings › Scoring | Definir la fórmula | criterios A, B, C…, fórmula, rangos | — |
| S09 | Ficha del lead | clic en una tarjeta | Datos, tareas, notas, chat | campos, valor de venta, puntuación, historial | — |

## 4. Flujos de usuario

```
F01 Automatizar una etapa
    S01 → S03 → «+» debajo de la etapa → S04 elegir acción → condiciones → regla de ejecución → guardar
    happy path: unos 6 clics
    edge: sin canal conectado (Salesbot/email no disponibles), plantilla de email inexistente

F02 Construir un bot de calificación
    S05 → mensaje con botones → condición sobre la respuesta → acción «cambiar etapa» → pausa «hasta recibir mensaje» → detener bot
    edge: el cliente no responde (rama «No answer» con temporizador), responde otra cosa (rama «Another answer»)

F03 Seguimiento por tiempo
    S07 → «X horas después del último mensaje entrante» o «al mover a la etapa, después de 1 día» → mensaje de recordatorio

F04 Cerrar una venta
    S01 → arrastrar la tarjeta → soltar en «Won» o «Lost» → sale del embudo y cuenta en estadísticas

F05 Recordatorio por fecha
    S07 → «N horas antes del campo Fecha de la cita» → mensaje o tarea
```

## 5. Componentes

| componente | variantes | estados | pantallas |
| --- | --- | --- | --- |
| Columna de etapa | normal, entrantes, ganado, perdido | vacía, con leads, arrastre encima | S01 |
| Celda de disparador | por tipo de acción (icono) | activa, pausada, con error | S03 |
| Selector de regla de ejecución | inmediato, con espera (5 min, 10 min, 1 día, intervalo) | — | S04, S07 |
| Filtros del disparador | etiquetas (y/o), sin etiquetas, etapa, responsable, rango de venta, fuente, UTM | vacío, con filtros | S04, S07 |
| Paso del bot | mensaje, lista, condición, pausa, validación, acción, ir a paso, iniciar bot, código, widget, round robin | conectado, suelto | S05 |
| Botones de respuesta | hasta 13 (recomienda 3), sinónimos, botón URL, ramas «otra respuesta» y «sin respuesta» | — | S05 |
| Ramas de entrega | enviado, entregado, fallido | — | S05 |

## 6. Modelo de datos inferido

```
Pipeline        id, name, order
                evidencia: «create separate pipelines for products, channels or departments». Confianza: alta

Stage           id, pipeline_id, name, order, color, kind (normal | incoming | won | lost)
                evidencia: colores de etapa, «Won»/«Lost» al arrastrar, etapa de entrantes. Confianza: alta

Lead            id, pipeline_id, stage_id, responsible_user_id, sale (valor), tags[], score,
                utm_* , source_id, custom_fields, closed_at
                evidencia: filtros «Sale», «Source», UTM; puntuación junto a la etapa. Confianza: alta

Trigger         id, stage_id, action_type, action_config (json), conditions (json),
                execute_rule (moved | created | moved_or_created | responsible_changed | tag_added |
                tag_removed | field_updated | scheduled_relative | scheduled_date | recurring |
                form_submitted | email_received | call_received | conversation_started |
                incoming_message | outgoing_seen | after_closed | after_last_incoming),
                delay_seconds, active_hours, apply_to_existing (bool), channels[]
                evidencia: artículos de disparadores. Confianza: media (nombres de campos inferidos)

Task            id, lead_id, responsible_user_id, type (follow up | meeting | personalizado),
                due_at, comment, completed_at, result
                evidencia: acciones «Add task» y «Complete tasks». Confianza: alta

Bot / BotStep   id, name, steps (json: type, config, next), triggers[]
                evidencia: constructor visual + «View source» (JSON). Confianza: alta

LossReason      id, name  — SUPOSICIÓN: no aparece en los artículos leídos. Confianza: baja

ScoringRule     criteria (A, B, C: etapa, UTM, campo → puntos), formula, min, max, priority ranges
                evidencia: artículo de puntuación. Confianza: alta
```

## 7. Comparación con Driony (resumen)

Driony ya cubre el núcleo: varios embudos, etapas con rol (ganado, perdido,
calificado), etapa de entrantes con descarte automático, agente de IA por
embudo, eventos de conversión de Meta por etapa, automatizaciones por etapa
que lanzan un flujo (entra a la etapa, mensaje entrante, webhook, sin
respuesta), y un constructor de flujos con 16 tipos de bloque (mensaje,
pregunta con validación, botones, plantilla, condición, acción, espera, HTTP,
asignar, campo, nota, estado, A/B, horario, saltar a flujo) y 11 disparadores.

Lo que le falta, por impacto:

1. **Espera en «entra a la etapa»**: Kommo deja «después de 5 min, 1 día o un intervalo». En Driony, solo «sin respuesta» tiene espera.
2. **Filtros en las automatizaciones de etapa**: etiquetas (y/o), sin etiqueta, responsable, valor, fuente y UTM, antes de lanzar nada.
3. **Aplicar a los leads que ya están en la etapa** al crear la automatización.
4. **Tareas**: crear, completar y vencer tareas por lead, con responsable y tipo. Driony no tiene tareas.
5. **Rama «sin respuesta» con temporizador** en botones y preguntas, más una rama «otra respuesta» en las preguntas.
6. **Lista de WhatsApp** (hasta 10 opciones en secciones). Driony solo tiene 3 botones.
7. **Reparto rotativo (round robin)** de responsables y de respuestas.
8. **Disparadores nuevos**: cambio de responsable, etiqueta quitada, campo actualizado, X horas antes o después de un campo fecha, fecha fija y recurrente, X horas después del último mensaje entrante, y mensaje saliente leído.
9. **Motivos de pérdida y zonas Ganado/Perdido** al arrastrar en el tablero.
10. **Colores de etapa**, **puntuación de leads**, **mover o duplicar automatizaciones** entre etapas, y **ramas de entrega** (enviado, entregado, fallido).

## 8. Lo que no se replica

| qué | por qué |
| --- | --- |
| Instagram «mención en historia», comentarios de Instagram, suscriptores de Meta | Driony aún no tiene canal de Instagram |
| Disparador «al abrir o cerrar un vídeo», «al visitar una web» | Dependen de su widget de chat web y su píxel |
| Acción «Delete files» | Driony ya tiene retención de adjuntos por plan |
| Widgets de su marketplace (Stripe, Mailer…) | Ecosistema de terceros de Kommo |
| «Send email» y «al recibir un email» | Driony no tiene canal de email. Posible en el futuro: skip por ahora |
| Paso «Code» (JS propio) | Riesgo de seguridad en multi-empresa. El bloque HTTP cubre lo esencial |
| Plantillas de bots de Kommo, sus textos y su marca | Son propiedad de Kommo |

## 9. Tamaño

- Pantallas: 9 en Kommo. En Driony casi todas existen: hay que ampliar S03/S04 (automatizaciones de etapa) y S05 (bloques nuevos), y crear Tareas.
- Flujos: 5. Entidades nuevas en Driony: Task y LossReason, más campos en StageAutomation.
- Partes difíciles: (1) disparadores programados (relativos a un campo fecha, recurrentes) con un planificador fiable y sin duplicados; (2) «aplicar a los leads existentes» de forma masiva sin saturar WhatsApp; (3) tareas con vencimientos, avisos y una vista propia.
- Tamaño: **M** (unas semanas) para los puntos 1 a 7. Los puntos 8 a 10 suman otro **M**.

Siguiente paso: `/replica-architect` para convertir los huecos en esquema y orden de construcción, o empezar directamente por los puntos 1 a 3, que son baratos y de mucho impacto.
