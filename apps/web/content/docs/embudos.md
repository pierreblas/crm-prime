# Embudos

Un embudo es un tablero de oportunidades con etapas. Puedes tener **varios** —Ventas, Soporte, Renovaciones— y cada número de WhatsApp decide a cuál entran sus conversaciones: se elige en **WhatsApp › Configurar** (en el número) o aquí, marcando los números de cada embudo.

## Etapas

En **Ajustes › Embudos y etapas** creas embudos y, dentro de cada uno, sus etapas. Dos marcas especiales:

- **Potencial**: donde el agente de IA (acción `mark_lead`) manda a quien muestra interés real: pide precio, cotización, quiere comprar.
- **Ganada (compra)**: las oportunidades que llegan aquí cuentan como cerradas con éxito; el agente las marca cuando el cliente confirma la compra.
- **Perdida**: cerradas sin venta.

Con esos tres roles el agente clasifica solo: *potencial → compra* o *perdido*, y coloca cada contacto en la etapa que corresponde del embudo donde ya está su oportunidad (o del predeterminado, si no tiene). Cada embudo tiene sus propias etapas con rol: un lead del embudo *Soporte* nunca aterriza en el *Ganado* de *Ventas*.

## Automatizaciones por etapa

Cada etapa tiene una lista libre de automatizaciones: **«cuando pase X, ejecuta el flujo Y»**. Añades tantas como quieras desde el botón de la columna *Automatizaciones* en **Ajustes › Embudos y etapas**; el tablero muestra en cada columna cuántas tiene (⚡). Disparadores:

| Cuándo | Qué pasa |
|---|---|
| **Entra a la etapa** | La oportunidad llega a la columna: a mano, por el agente de IA, por otro flujo o al crearse ahí (también la entrada automática de WhatsApp). |
| **Llega un mensaje del cliente** | Con cada mensaje que escribe mientras su oportunidad está en la etapa. Si el flujo arranca, la IA no responde ese turno. |
| **Llega un webhook** | Un sistema tuyo llama a la URL de la automatización (botón *Copiar URL*) con `{ "phone": "+51…" }` o `{ "contactId": "…" }`, y opcionalmente `"vars": { … }` para el flujo. Solo actúa si la oportunidad del contacto está en esa etapa. |
| **Pasa tiempo sin respuesta** | El cliente lleva ese tiempo sin contestar vuestro último mensaje estando en la etapa. Una vez por estancia: si vuelve a entrar en la etapa, puede repetirse. |

Los flujos se crean en [Flujos](/docs/flujos); para uno que solo deba correr desde el embudo, elige el disparador **«Solo desde una etapa del embudo»**. El flujo corre en la conversación abierta del contacto (o abre una nueva); si otro flujo está a medias esperando su respuesta, no arranca. Un flujo desactivado no corre aunque esté enganchado: pausa la automatización con su casilla *activa* o actívalo en Flujos.

Ejemplos: *Entrantes* → «Entra a la etapa → Bienvenida»; *Propuesta* → «Pasa 1 día sin respuesta → Seguimiento» y «Llega un webhook → Enviar cotización» desde tu ERP; *Ganado* → «Entra a la etapa → Gracias y encuesta».

## Agente de IA del embudo

Cada embudo puede tener su **agente de IA**: quién responde a los contactos cuya oportunidad está ahí. Si no se elige, responde el agente del **número de WhatsApp** o, en su defecto, el **predeterminado**. Para que en una etapa no responda la IA, usa un flujo que pase la conversación a una persona.

Uno de los embudos es el **predeterminado**: es el que usan el agente de IA, los leads de Meta y la API pública cuando no se indica otro.

## El tablero

En **Pipeline** ves el embudo con sus columnas. Arrastra las tarjetas de una etapa a otra, ábrelas para editar título, valor, vendedor, etiquetas y campos del lead, y márcalas como ganadas o perdidas. Con varios embudos, arriba aparece un selector con el número de oportunidades abiertas de cada uno.

Cada tarjeta muestra la **fuente** del contacto, sus **etiquetas**, el vendedor y el estado de su chat: si el cliente **espera respuesta** (y cuánto lleva; en rojo pasada una hora) o cuándo fue el último mensaje. El icono de mensaje abre la conversación en la bandeja; desde el panel de la tarjeta, **Abrir chat** hace lo mismo. La columna con el icono de bandeja es la **etapa de entrada** (ver abajo).

Encima de las columnas puedes **buscar** por título, nombre o teléfono y, con **Filtros**, acotar por etiquetas (varias a la vez, o «sin etiqueta»), fuente, vendedor, fecha (de creación o del último mensaje: hoy, 7 días, 30 días o un rango) y valor mínimo/máximo; aparte, **Esperando respuesta** deja solo las que tienen al cliente esperando. Los totales de cada columna se recalculan con lo filtrado. Desde la bandeja, **Ver tablero** en el panel del contacto abre su tarjeta aquí.

## Entrada automática desde WhatsApp

Es la manera recomendada de trabajar: que ninguna conversación se quede fuera del embudo.

Activa en el embudo **«Crear una oportunidad al primer mensaje de WhatsApp»** y elige:

- **Etapa de entrada**: donde aparecen (te recomendamos una primera etapa llamada *Entrantes*).
- **Días para descartar**: si el contacto no vuelve a escribir en ese plazo y nadie movió la oportunidad, se descarta sola (0 = nunca).
- **Números** cuyas conversaciones entran a este embudo.

Con eso, cuando escribe un contacto **sin ninguna oportunidad en curso**:

1. se crea una en la etapa de entrada, con el nombre del contacto y su fuente;
2. se asigna al **vendedor de esa fuente con menos oportunidades abiertas** (reparto parejo);
3. si el contacto ya tenía una oportunidad ganada o perdida, se abre una nueva; si tenía una en curso, no se duplica.

Las empresas nuevas traen esto activado en su embudo *Ventas*, con la etapa *Entrantes*.

## Descartar

No todo el que escribe quiere comprar. **Descartar** («no es una venta») saca la oportunidad del tablero sin borrarla: queda en **Descartadas**, sigue contando para las métricas y se puede restaurar. Si una oportunidad descartada por inactividad recibe un mensaje nuevo del contacto, **vuelve sola** a la etapa de entrada.

## Quién mueve las oportunidades

- **Tú**, arrastrando en el tablero.
- **El agente de IA**, con la acción *Mover en pipeline* cuando detecta intención (ver [Agentes](/docs/agentes)).
- **Un flujo**, con el bloque *Acción → Mover en pipeline* ([Flujos](/docs/flujos)).
- **Tu sistema**, por la [API pública](/docs/api), por nombre de etapa.

Cada cambio de etapa dispara el webhook `deal.stage_changed` si lo tienes suscrito.
