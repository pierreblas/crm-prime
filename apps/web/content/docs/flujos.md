# Flujos

Un flujo es una automatización paso a paso: «cuando pase esto, envía esto, pregunta aquello y según la respuesta haz tal cosa». Se construye arrastrando bloques en un lienzo, sin código. Son ideales para lo que es siempre igual (bienvenida, menú, recogida de datos); para lo que requiere conversación de verdad, un [agente de IA](/docs/agentes).

## Disparadores

Un flujo arranca cuando pasa una de estas cosas. Se elige arriba, en el editor, junto a su filtro.

| Disparador | Cuándo | Filtro |
|---|---|---|
| **Al iniciar un chat** | Un contacto escribe por primera vez o abre una conversación nueva. | — |
| **Por palabra clave** | Un mensaje del contacto contiene alguna de las palabras. | Palabras separadas por comas. |
| **Llega desde un anuncio** | La conversación nace de un anuncio Click to WhatsApp de Meta. Tiene prioridad sobre «Al iniciar un chat». | — |
| **Nuevo lead de Meta Ads (formulario)** | Entra un lead de un formulario de Meta Lead Ads ([Meta Ads](/docs/meta-ads)). | Nombres de formulario; vacío = todos. |
| **Nuevo lead por API o formulario web** | Entra un lead por el [webhook de leads](/docs/webhooks) o la API (tu web, n8n, Zapier). | — |
| **Se le pone una etiqueta** | Alguien, la IA u otro flujo etiqueta al contacto. | Etiquetas; vacío = cualquiera. |
| **Cambia de etapa en el embudo** | Su oportunidad se mueve a una etapa, a mano, por la IA o por otro flujo. | Una etapa; vacío = cualquiera. |
| **Se cierra la conversación** | Tu equipo cierra la conversación. Útil para una encuesta o una despedida. | — |
| **El cliente no responde** | Pasan X horas sin que el cliente conteste a tu último mensaje (de una persona, de la IA o de un flujo). Se dispara una vez por silencio: no se repite hasta que el cliente vuelva a escribir. | Horas (1 a 720). |
| **Llamada perdida** | Alguien llama al número de la empresa ([Twilio](/docs/llamadas)) y nadie contesta. Como el cliente quizá no te ha escrito, usa «Enviar plantilla». | — |
| **Solo desde una etapa del embudo** | No arranca solo: lo ejecutan las [automatizaciones de una etapa](/docs/embudos) (al entrar, al escribir el cliente, por webhook o tras un silencio). | — |

Dos cosas a tener en cuenta:

- **Los leads de formularios nunca te han escrito.** WhatsApp solo permite escribirles con una plantilla aprobada: en esos flujos usa el bloque **Enviar plantilla** (o etiqueta, mueve el embudo y avisa por HTTP, que no necesitan ventana abierta). Lo mismo si el cliente lleva más de 24 h callado.
- Si en esa conversación ya hay un flujo a medias (esperando una respuesta o un «Esperar»), el nuevo no lo interrumpe: se registra en el log y no arranca.

Cada flujo puede aplicar a **un número** o a todos, y hay que marcarlo **Activo** para que corra. Un flujo con avisos no se puede activar hasta corregirlos.

## Bloques

| Bloque | Para qué |
|---|---|
| **Enviar mensaje** | Un texto al contacto, con una imagen o archivo opcional (el texto va de pie). Admite variables: `{{nombre_variable}}`. |
| **Botones** | Un mensaje con hasta 3 botones de respuesta (20 caracteres cada uno). Cada botón es una salida; *otra respuesta* recoge lo que no sea un botón (si el contacto escribe el texto del botón o su número, cuenta como pulsado). Fuera de la ventana de 24 h va como texto con opciones numeradas. |
| **Enviar plantilla** | Una plantilla aprobada por Meta. Es la única forma de escribirle a quien no te ha escrito o lleva más de 24 h sin hacerlo. Si tiene `{{1}}`, va el nombre del contacto. |
| **Preguntar y guardar** | Envía una pregunta, espera la respuesta y la guarda en una variable. Puede exigir que sea un teléfono, un correo, un número o un patrón; si no lo es, repite la pregunta hasta N intentos y luego sigue por la salida *si no es válida*. |
| **Condición** | Ramifica por reglas. Cada rama es una salida con una o varias condiciones (todas o alguna) sobre: el **mensaje** del cliente (contiene, es igual, empieza por, regex, vacío…), una **variable**, el **contacto** (nombre, teléfono, campos personalizados, etiqueta, fuente), la **conversación** (estado, asignada a, modo de IA, número de WhatsApp, si es su primer mensaje, cuántos mensajes lleva) o la **etapa** de su oportunidad. *En otro caso* es la salida por defecto. Gana la primera rama que se cumple, en orden. |
| **Acción** | Pasar al agente de IA, pasar a humano, poner o quitar una etiqueta, mover en el embudo o crear una oportunidad en una etapa (si ya tiene una abierta en ese embudo, no se duplica). |
| **Horario** | Dos salidas: *en horario* y *fuera de horario*, según los días y horas que marques (con su zona horaria). |
| **Dividir al azar** | Reparte a cada contacto entre varias variantes según su peso (A/B de mensajes, reparto entre vendedores). |
| **Esperar** | Pausa de minutos u horas. Si el contacto escribe durante la espera, el flujo sigue con su mensaje. |
| **Guardar en el contacto** | Escribe un valor (o una variable) en el nombre del contacto o en uno de sus campos personalizados. |
| **Nota interna** | Deja una nota en la conversación, visible solo para el equipo. |
| **Estado del chat** | Deja la conversación abierta, pendiente (esperando a una persona) o cerrada. |
| **Petición HTTP** | Llama a una API o a n8n (GET/POST…), con cabeceras y cuerpo; puede guardar la respuesta en una variable. |
| **Asignar a agente** | Asigna la conversación a una persona del equipo. |
| **Ir a otro flujo** | Continúa en otro flujo. No tiene salida. |

### Enlazar bloques

Cada salida de un bloque es un punto en su borde. Mientras está libre muestra un **+**: haz clic para elegir el bloque que sigue (queda conectado) o **arrastra** desde él y suelta **sobre cualquier parte** del bloque destino; si sueltas en el vacío, eliges ahí mismo qué bloque crear. Cada salida admite una sola conexión; al pasar el ratón por una línea aparecen **+** (insertar en medio) y **×** (quitar). **Doble clic** en el lienzo añade un bloque suelto.

Los textos de **Enviar mensaje**, **Preguntar**, **Botones** y **Nota** se escriben en el propio bloque al seleccionarlo (los botones también se añaden y quitan ahí); el resto de opciones van en el panel de la derecha.

## Variables

Las crean los bloques **Preguntar y guardar** y **Petición HTTP** (*guardar respuesta en*). Se usan en cualquier texto como `{{nombre_de_la_variable}}`. En el panel de cada bloque de texto aparecen las variables del flujo para insertarlas con un clic.

## El editor

- **«+» en cada salida**: añade el siguiente bloque ya conectado. En una conexión, su «+» inserta un bloque en medio y «×» la quita.
- **Paleta**: clic para añadir en el centro, o arrastra al lienzo.
- **Conectar a mano**: arrastra desde el punto ● de una salida hasta la entrada de otro bloque. Una salida solo puede tener una conexión.
- **Deshacer / rehacer** (Ctrl+Z / Ctrl+Shift+Z), **duplicar** (Ctrl+D), **eliminar** (Supr), **guardar** (Ctrl+S) y **Ordenar**, que recoloca todo por niveles.
- **Avisos**: cada bloque marca lo que le falta (texto, variable, URL…); el botón de avisos lista todos y te lleva al bloque.

## Asistente

El botón **Asistente** construye o modifica el flujo a partir de una descripción en lenguaje natural («un menú con tres opciones: precios, soporte y hablar con alguien»). Lo que propone se aplica al lienzo y se puede deshacer.
