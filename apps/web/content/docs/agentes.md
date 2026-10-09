# Agentes de IA

Un agente es un asistente configurado por ti que atiende las conversaciones: responde con tu información, califica al cliente y actúa sobre el CRM. Puedes tener varios (uno por número, por ejemplo) y uno **por defecto** para lo que no tenga agente propio.

## Tu API key

Los agentes usan **tu** cuenta del proveedor de modelos. En **Ajustes › Inteligencia Artificial**:

- **OpenAI** o **Anthropic (Claude)**: pega tu API key y elige el modelo por defecto.
- **Cualquier API compatible con OpenAI** (Groq, DeepSeek, OpenRouter, Ollama…): pon su URL base en el campo *URL base* de OpenAI, con la key y el modelo de ese servicio.
- Pulsa **Probar conexión**: hace una llamada real y te dice si funciona.

Las keys se guardan cifradas y solo las usa tu empresa. Cada respuesta se cobra en tu cuenta del proveedor.

## Crear un agente

La forma más fácil es **Agentes IA › Con ayuda** (o «Armar mi agente» en Primeros pasos): un asistente te hace cinco preguntas, qué vendes y a quién, cuál es su misión, qué puede hacer, cuándo te pasa el chat y cómo empieza, y con tus respuestas redacta las instrucciones. Al terminar puedes probarlo en una conversación simulada. Si tu agente principal todavía tiene las instrucciones genéricas, el asistente lo configura a él en vez de crear otro.

Para hacerlo a mano, **Agentes IA › Nuevo**. Arriba, siempre a la vista, están las tres decisiones clave:

- **Activo o pausado**: pausado, no responde a nadie.
- **Atiende**: el número de WhatsApp que atiende. Sin número, atiende todos los que no tengan un agente propio.
- **En los chats nuevos**: **Responde solo** (contesta sin esperar a nadie; tu equipo puede tomar el control de cualquier chat) o **Te sugiere** (redacta cada respuesta y espera a que alguien la revise y la envíe). Ver [Bandeja](/docs/bandeja#copilot-y-autopilot).

Debajo, cinco pestañas:

- **Qué dice**: el nombre y **cómo debe atender**, lo más importante del agente: qué vendes y a quién, el tono de tu marca, qué no debe hacer y cuándo pasarte el chat. Si todavía tiene las instrucciones genéricas, te lo avisa y el asistente te las redacta.
- **Qué puede hacer**: lo que puede consultar para responder bien (productos y precios, tu información, la ficha del cliente) y lo que puede hacer en el CRM para ahorrarte trabajo (etiquetar, mover en el embudo, enviar fotos…).
- **Cuándo responde**: cuántos segundos espera antes de contestar (si el cliente escribe en varios mensajes seguidos, responde una sola vez a todo; recomendado 3 a 5), saludo automático, horario de atención y respuestas fijas por palabra clave.
- **Respuestas por palabra clave**: si el mensaje contiene alguna de las palabras («medios de pago», «cuenta», «transferencia»), el agente responde ese texto exacto sin pasar por la IA: ideal para cuentas bancarias, direcciones o políticas que no deben cambiar ni una letra. Cada respuesta admite **versiones con condiciones**, las mismas del bloque «Condición» de los flujos: país del cliente (por el prefijo de su teléfono: +51 Perú, +52 México…), etiqueta, etapa de su oportunidad, fuente, número de WhatsApp, un campo del contacto… Se prueban en orden y gana la primera que se cumple; quien no cumpla ninguna recibe el texto general. Las palabras se comparan sin distinguir mayúsculas; una respuesta por palabra tiene prioridad sobre todo lo demás y no mueve la conversación.
- **Cuándo te pasa el chat**: palabras que lo pasan a tu equipo al momento, cuánta señal necesita para apartarse por su cuenta y **qué le dice al cliente** al retirarse (para que no se quede en silencio). El chat queda como *Pendiente* y en él aparece una nota interna con el motivo.
- **Si cierras una conversación** («Cerrar y siguiente») y el cliente vuelve a escribir, se abre una nueva que hereda el modo de la IA de la anterior, y el agente sigue viendo los mensajes de los últimos 30 días del contacto para no perder el hilo.
- **Modelo y gasto**: qué IA usa, con lo que cuesta cada 1.000 respuestas, y un **límite de gasto al mes en dólares**. En *Ajustes avanzados*, cuánto piensa antes de responder y cuántas consultas puede hacer por respuesta.

La barra de abajo te dice si hay **cambios sin guardar**, y al guardar lo confirma. Ctrl+S (Cmd+S en Mac) guarda desde cualquier pestaña. Si cambias de agente con cambios pendientes, Driony te avisa antes de perderlos.

## Asistente de redacción

No hace falta saber escribir un *system prompt*. Junto al campo de instrucciones (y junto a la bienvenida y al mensaje fuera de horario) hay un botón **Asistente**:

1. Cuentas qué vendes y a quién, el objetivo del agente (vender, agendar, dar soporte…) y el tono.
2. El asistente propone unas instrucciones completas: rol, objetivo, tono para WhatsApp, cuándo usar cada herramienta que tengas activada, límites, cuándo pasar a una persona y ejemplos.
3. Pides ajustes en el chat («más corto», «de usted», «añade los horarios») y, cuando te convenza, pulsas **Usar este texto**. Nada se guarda hasta que guardas el agente.

Usa tu propio modelo (Ajustes › Inteligencia Artificial) y conoce tu contexto real: catálogo, base de conocimiento, etapas del embudo y herramientas del agente, así que no inventa nombres de herramientas ni productos. Lo que no sabe lo deja marcado entre corchetes, como `[HORARIO]`, para que lo rellenes. También sirve para cualquier otro texto: un guion de ventas, una respuesta a una objeción o un mensaje de seguimiento.

## Herramientas y acciones

| Consulta | Qué hace |
|---|---|
| `search_knowledge` | Busca en tu [base de conocimiento](#base-de-conocimiento) |
| `search_products` | Busca en tu catálogo (Productos), también por sus características como talla o color |
| `search_contact` | Lee la ficha del contacto |

| Acción | Qué hace |
|---|---|
| `add_tag` / `remove_tag` | Etiqueta al contacto |
| `mark_lead` | Clasifica al contacto como **potencial**, **compra** o **perdido** y lo coloca en la etapa que tiene ese rol en su embudo (ver [Embudos](/docs/embudos)) |
| `move_deal_stage` | Mueve (o crea) su oportunidad a una etapa concreta del embudo predeterminado |
| `update_contact` | Actualiza la ficha y los campos personalizados |
| `assign_to_seller` | Asigna un vendedor |
| `send_product_image` | Envía la foto de un producto |
| `handoff_to_human` | Pasa la conversación a una persona: el chat queda *Pendiente*, el equipo recibe un aviso y una nota con el motivo, y el cliente recibe la despedida que la IA redactó (o el aviso configurado en *Cuándo te pasa el chat*) |

En Copilot las acciones quedan pendientes de aprobación; en Autopilot se aplican solas.

## Copiloto, memoria y conocimiento que aprende

Además del agente que responde solo, Driony ayuda a tu equipo dentro de cada conversación. **Todo funciona con tu propia clave** de OpenAI o Anthropic (Ajustes › Inteligencia Artificial): Driony no vende créditos ni cobra por la IA, pagas a tu proveedor al precio de su lista.

**En el cuadro de mensaje**, el botón de la varita reescribe tu borrador: mejorar la redacción, más cordial, más formal, más corto, corregir ortografía, o traducir al idioma del cliente (lo detecta de sus mensajes), al inglés o al portugués. Si no te convence, **Deshacer** devuelve tu texto.

**En Detalles** del chat, el panel **Copiloto** te da:

- **Resumir conversación**: qué quiere el cliente, datos clave y el siguiente paso, para retomar un chat largo en diez segundos.
- **Preguntar**: «¿qué le ofrecimos?», «¿cuánto presupuesto tiene?», «redáctale un seguimiento». Responde con la ficha, las oportunidades, las notas internas, las conversaciones anteriores y tu base de conocimiento. Cualquier respuesta se puede usar como borrador.
- **Memoria del cliente**: un resumen y los datos útiles de todas sus conversaciones (preferencias, productos que le interesan, presupuesto, compromisos). Se actualiza sola al cerrar cada conversación y **el agente automático la usa** para no volver a preguntar lo que ya sabe.

**En Conocimiento**:

- **Preguntas sin respuesta**: la IA lee las conversaciones de los últimos 30 días y detecta lo que tus clientes preguntan y tu conocimiento no cubre, con una respuesta propuesta a partir de cómo contestó tu equipo. La revisas, la apruebas y el agente la usa desde ese momento. Lo que descartas no vuelve a salir.
- **Importar web**: pega la dirección de tu página de preguntas frecuentes o de envíos (y, si quieres, las del mismo sitio que enlaza). Volver a importarla la actualiza.
- La búsqueda del conocimiento también usa tu clave de OpenAI. Si cambias de proveedor, Driony te avisa para **reindexar** los documentos.

## Pedirle que pase el chat

Para que el agente se retire en un caso concreto, díselo en **Cómo debe atender** y deja activada la acción `handoff_to_human` en *Qué puede hacer*. Cada acción muestra ahí su **nombre técnico** (con botón de copiar), que es como la IA la conoce; en «Cómo debe atender» hay un desplegable, *Cómo nombrar sus acciones en las instrucciones*, con los de las acciones activas. Por ejemplo, para comprobantes de pago:

> Cuando el cliente envíe un comprobante de pago (foto o captura de una transferencia, Yape, Plin o similar): agradece, dile que una persona del equipo validará el pago en unos minutos y usa la herramienta handoff_to_human con el motivo «comprobante de pago». No confirmes tú el pago ni des por entregado nada.

Al hacerlo, el cliente recibe exactamente lo que la IA redactó («Gracias, una persona validará tu pago…»), la conversación pasa a **Pendiente**, el equipo ve un aviso en la bandeja y una nota interna con el motivo.

Como la IA puede decirlo y olvidarse de llamar a la herramienta, para los comprobantes conviene además la opción **«Pasar siempre el chat cuando el cliente envía una imagen o un documento»** (*Cuándo te pasa el chat*): es determinista. La IA sigue contestando lo que le indicaste y el chat pasa a Pendiente en cuanto llega la imagen. Si la IA se retira sin haber escrito nada (reglas de escalado, cliente molesto, no sabe qué responder), el cliente recibe el aviso de *Cuándo te pasa el chat*.

Las **imágenes** que manda el cliente se describen antes de responder (con la misma clave de IA del agente), así la IA sabe que es un comprobante, una foto del producto o una captura; los audios se transcriben. Hace falta una clave con visión: OpenAI (gpt-4o-mini o superior) o Anthropic. Si la clave viene de un proveedor intermedio que no la ofrece, la IA verá «[imagen]» sin descripción, lo dirá y pedirá al cliente que le cuente qué es; en el registro de la API aparece el aviso «El modelo de visión no vio…».

## Precios en varias monedas

Cada producto tiene un **precio base** y, si quieres, **precios en otras monedas** (Productos › Editar › *Añadir precio en otra moneda*, o columnas `price_USD`, `price_MXN`… al importar desde Excel o CSV). No hay conversión automática: el precio en cada moneda lo decides tú.

A cada contacto se le cotiza en la moneda de **su país**, que Driony deduce del prefijo de su teléfono (+52 → México → MXN, +51 → Perú → PEN). Si hace falta otra, se cambia en su ficha (*País y moneda para cotizar*).

- El agente recibe los precios de `search_products` ya en la moneda del cliente. Si un producto no tiene precio en esa moneda, le da el precio base con su moneda, sin inventar una conversión.
- Las oportunidades nuevas nacen en la moneda del contacto, y se puede cambiar en su detalle. Cada columna del embudo suma por separado cada moneda.

## Campos del catálogo

El catálogo sirve para productos, servicios, talleres o lo que vendas. En **Productos › Campos** decides qué datos guardas de cada uno: talla o color, duración o modalidad, fecha de inicio y cupos… No hay campos fijos.

- **Tipos**: texto corto, texto largo, número (con unidad, como `min` o `cupos`), fecha, hora, sí / no, una opción de una lista, varias opciones y enlace.
- **Configuración de cada campo**: texto de ayuda, obligatorio, si se ve en la tarjeta y si lo usa el agente de IA. Apaga esto último para datos internos, como el costo o el proveedor. El orden se cambia con las flechas.
- **Ideas para empezar**: grupos listos para tiendas, servicios, talleres y uso interno. Un clic los añade y después se pueden cambiar.
- **Importar desde Excel o CSV**: añade una columna con el nombre del campo; la plantilla de ejemplo (Excel o CSV, con productos en varias monedas) ya la incluye. Las columnas van en inglés (`name`, `sku`, `price`, `currency`, `description`, `image_url`, `active`), aunque los títulos en español también se reconocen. Las fechas aceptan `31/12/2026`, los sí / no aceptan `si` o `no`, y en las listas se rechaza un valor que no esté entre las opciones.
- **Agente de IA**: recibe los campos visibles en `search_products` y también encuentra productos por ellos (por ejemplo, «taller los jueves»). Los campos internos no se le envían ni se usan para buscar.
- Si borras un campo, sus valores no se pierden: reaparecen al volver a crearlo con el mismo nombre.

## Audios, imágenes y stickers

Cuando un cliente manda un **audio**, Driony lo transcribe; una **imagen** o un **sticker**, los describe (si es un comprobante, un pedido o una captura, saca los datos que se leen). Eso se guarda bajo el mensaje en la bandeja, con el icono de la IA, y el agente lo lee como parte de la conversación: responde a lo que dijo el audio o a lo que muestra la foto, en vez de ignorarlo.

- La transcripción usa tu clave de **OpenAI**. Con solo Anthropic, los audios no se transcriben; las imágenes sí se describen con cualquiera de los dos.
- Se cobra en tu cuenta del proveedor y aparece en **Consumo de IA** como «Audios e imágenes de clientes». Un audio de un minuto cuesta menos de un centavo de dólar.
- Los videos y documentos no se interpretan todavía; el agente ve que llegaron.

## Base de conocimiento

En **Conocimiento** subes documentos (precios, condiciones, preguntas frecuentes, guías). Se trocean y se indexan para que el agente responda **con tu información** en vez de inventar. Cada consulta suma un poco de tiempo y de gasto; activa la herramienta solo en los agentes que la necesiten.

## Límite de gasto

Cada respuesta registra sus tokens y su coste. En el agente ves el gasto del mes y puedes poner un **tope mensual**: al alcanzarlo, la IA deja de responder con ese agente y las conversaciones pasan a tu equipo. Sin sorpresas en la factura del proveedor.

## Playground

Antes de activar un agente, pruébalo en el **Playground**: una conversación simulada donde ves la respuesta, las herramientas que usó, los tokens y el coste de cada turno.
