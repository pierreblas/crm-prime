# Flujos

Un flujo es una automatización paso a paso: «cuando pase esto, envía esto, pregunta aquello y según la respuesta haz tal cosa». Se construye arrastrando bloques en un lienzo, sin código. Son ideales para lo que es siempre igual (bienvenida, menú, recogida de datos); para lo que requiere conversación de verdad, un [agente de IA](/docs/agentes).

## Disparadores

Un flujo puede tener **varios disparadores** (hasta 10) y arranca con el primero que se cumpla entero: por ejemplo, «Por palabra clave: promo», «Se le pone la etiqueta VIP» y «Llega desde un anuncio» en el mismo flujo. Se configuran en el bloque **Inicio**: púlsalo y, en el panel, **Añadir disparador**. El bloque Inicio los muestra en el lienzo con su resumen («a los 10 min · 2 condiciones · en horario»), y la barra superior dice cuántos tiene.

Cada disparador tiene cuatro partes:

1. **El evento** y su filtro propio (las palabras, las etiquetas, las etapas, los formularios o las horas).
2. **Cuándo** (en los de embudo, etiquetas, cierre, leads y llamadas): *al momento*, *a los 5 o 10 min*, *a la 1 h*, *al día siguiente* u otro tiempo. Al vencer se comprueba otra vez que sigue valiendo: que la oportunidad siga en la etapa, que siga teniendo (o no) la etiqueta, el mismo responsable, y las condiciones.
3. **Condiciones** que también tienen que cumplirse, *todas* o *alguna*: tiene o no tiene una etiqueta, está en una etapa, el responsable de su oportunidad, el valor de su oportunidad, la fuente, los UTM con que llegó, el país, un campo del contacto, el número de WhatsApp… Por ejemplo: «Cambia de etapa a Propuesta», solo si tiene la etiqueta *VIP* y su oportunidad vale más de 500.
4. **Horario activo**: si lo marcas, fuera de esos días y horas el disparador no arranca nada.

| Disparador | Cuándo | Filtro |
|---|---|---|
| **Al iniciar un chat** | Empieza una conversación nueva: el primer mensaje de un contacto, o el primero después de cerrar su chat anterior. No se dispara con cada mensaje de un chat abierto: para eso, «Por palabra clave». Si ese primer mensaje trae una palabra clave de otro flujo, arranca ese. | — |
| **Por palabra clave** | Un mensaje del contacto contiene alguna de las palabras, sin importar tildes ni mayúsculas: «informacion» vale por «Información». Tiene prioridad sobre «Al iniciar un chat». | Palabras separadas por comas. |
| **Llega un mensaje del cliente** | Con cada mensaje que escribe (sin palabras concretas), como mucho una vez cada cierto tiempo por conversación. Pensado para usar con condiciones. | Pausa entre disparos (por defecto, 1 día). |
| **Llega desde un anuncio** | La conversación nace de un anuncio Click to WhatsApp de Meta. Tiene prioridad sobre «Al iniciar un chat». | — |
| **Nuevo lead de Meta Ads (formulario)** | Entra un lead de un formulario de Meta Lead Ads ([Meta Ads](/docs/meta-ads)). | Nombres de formulario; vacío = todos. |
| **Nuevo lead por API o formulario web** | Entra un lead por el [webhook de leads](/docs/webhooks) o la API (tu web, n8n, Zapier). | — |
| **Se le pone una etiqueta** | Alguien, la IA u otro flujo etiqueta al contacto. | Etiquetas; vacío = cualquiera. |
| **Se le quita una etiqueta** | Alguien, la IA u otro flujo le quita una etiqueta. | Etiquetas; vacío = cualquiera. |
| **Cambia el responsable** | Cambia el vendedor responsable de su oportunidad (a mano, en bloque o por la IA). Con la condición «Responsable de su oportunidad» eliges de quién. | — |
| **Cambia de etapa en el embudo** | Su oportunidad se mueve a una etapa, a mano, por la IA o por otro flujo. | Etapas; vacío = cualquiera. |
| **Se cierra la conversación** | Tu equipo cierra la conversación. Útil para una encuesta o una despedida. | — |
| **El cliente no responde** | Pasan X horas sin que el cliente conteste a tu último mensaje (de una persona, de la IA o de un flujo). Se dispara una vez por silencio: no se repite hasta que el cliente vuelva a escribir. | Horas (1 a 720). |
| **Llamada perdida** | Alguien llama al número de la empresa ([Twilio](/docs/llamadas)) y nadie contesta. Como el cliente quizá no te ha escrito, usa «Enviar plantilla». | — |

Un flujo **sin disparadores** no arranca solo: lo ejecutan las [automatizaciones de una etapa](/docs/embudos) (al entrar, al escribir el cliente, por webhook o tras un silencio) o el bloque «Ir a otro flujo».

Cuatro cosas a tener en cuenta:

- **Los leads de formularios nunca te han escrito.** WhatsApp solo permite escribirles con una plantilla aprobada: en esos flujos usa el bloque **Enviar plantilla** (o etiqueta, mueve el embudo y avisa por HTTP, que no necesitan ventana abierta). Lo mismo si el cliente lleva más de 24 h callado.
- Si en esa conversación ya hay un flujo a medias (esperando una respuesta o un «Esperar»), un disparador por evento (etiqueta, etapa, lead…) no lo interrumpe: se registra en el log y no arranca. Una **palabra clave** sí: si el cliente escribe la de otro flujo en vez de contestar, arranca ese flujo. La de su mismo flujo, mientras contesta a su pregunta, cuenta como respuesta.
- Una pregunta o un menú **sin contestar en 24 h** se da por abandonado: lo que escriba después el cliente ya no se toma como su respuesta y otros flujos pueden arrancar. Si pulsa un botón de ese menú, sigue valiendo.
- **Si un flujo se detiene por un error** (un mensaje normal a alguien que lleva más de 24 h sin escribir, una plantilla que Meta rechaza), queda una **nota interna en el chat** con el motivo, para saber por qué no siguió.

Cada flujo puede aplicar a **un número** o a todos, y hay que marcarlo **Activo** para que corra. Un flujo con avisos no se puede activar hasta corregirlos.

## Bloques

| Bloque | Para qué |
|---|---|
| **Enviar mensaje** | Un texto al contacto, con un adjunto opcional: **imagen** (hasta 5 MB), **video** MP4, **audio** (hasta 16 MB) o **documento** (PDF, Word, Excel). El texto va de pie; con un audio, que no admite pie, va después en otro mensaje. Se adjunta desde la propia cajita del lienzo (con el bloque elegido) o desde el panel. Admite variables: `{{nombre_variable}}`. |
| **Botones** | Un mensaje con hasta 3 botones de respuesta (20 caracteres cada uno) y, si quieres, una **imagen, un video o un documento arriba**. Cada botón es una salida; *otra respuesta* recoge lo que no sea un botón (si el contacto escribe el texto del botón, con o sin tildes, o su número, cuenta como pulsado). Si no conectas *otra respuesta*, lo que escriba sigue como un mensaje normal (la IA puede contestarlo) y los botones siguen valiendo. Fuera de la ventana de 24 h va como texto con opciones numeradas. |
| **Lista de opciones** | Un mensaje con un botón («Ver opciones») que abre hasta **10 opciones**, cada una con título (24 caracteres) y descripción (72). Cada opción es una salida, como en Botones. Fuera de la ventana de 24 h va como texto numerado. |
| **Carrusel** | De **2 a 10 tarjetas** deslizables, cada una con una **imagen o un video**, un texto corto (160 caracteres) y un botón. Con botón de *respuesta*, cada tarjeta es una salida del bloque (vale también escribir su número); con botón de *enlace*, abre tu web y el flujo sigue. Solo dentro de la ventana de 24 h; fuera de ella va como texto. |
| **Enviar plantilla** | Una plantilla aprobada por Meta. Es la única forma de escribirle a quien no te ha escrito o lleva más de 24 h sin hacerlo. En el panel eliges el valor de cada variable (`{{1}}` o `{{nombre}}`): el nombre o el teléfono del contacto, o un texto, que puede llevar variables del flujo. Sin tocarla, la primera es el nombre del contacto. |
| **Preguntar y guardar** | Envía una pregunta, espera la respuesta y la guarda en una variable. Puede exigir que sea un teléfono, un correo, un número o un patrón; si no lo es, repite la pregunta hasta N intentos y luego sigue por la salida *si no es válida*. |
| **Condición** | Ramifica por reglas. Cada rama es una salida con una o varias condiciones (todas o alguna) sobre: el **mensaje** del cliente (contiene, es igual, empieza por, regex, vacío…), una **variable**, el **contacto** (nombre, teléfono, campos personalizados, etiqueta, fuente), la **conversación** (estado, asignada a, modo de IA, número de WhatsApp, si es su primer mensaje, cuántos mensajes lleva) o la **etapa** de su oportunidad. *En otro caso* es la salida por defecto. Gana la primera rama que se cumple, en orden. |
| **Acción** | Pasar al agente de IA, pasar a humano, poner o quitar una etiqueta, mover en el embudo o crear una oportunidad en una etapa (si ya tiene una abierta en ese embudo, no se duplica). |
| **Horario** | Dos salidas: *en horario* y *fuera de horario*, según los días y horas que marques (con su zona horaria). |
| **Dividir al azar** | Reparte a cada contacto entre varias variantes según su peso (A/B de mensajes, reparto entre vendedores). |
| **Esperar** | Pausa de minutos u horas. Lo que escriba el contacto durante la pausa no lo contesta nadie (tampoco la IA) hasta que el flujo siga, y las condiciones de después miran su último mensaje. Si escribe una palabra clave, arranca ese flujo y la pausa se cancela. |
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
