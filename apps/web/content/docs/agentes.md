# Agentes de IA

Un agente es un asistente configurado por ti que atiende las conversaciones: responde con tu información, califica al cliente y actúa sobre el CRM. Puedes tener varios (uno por número, por ejemplo) y uno **principal**, que contesta en los números que no tienen agente propio.

## Quién paga la IA: la incluida en tu plan o tu propia clave

Tu plan trae **IA incluida** con un cupo de tokens al mes (ver [Planes](/docs/planes#ia-incluida-y-tokens-extra)): el agente, el copiloto y los asistentes funcionan sin que configures nada. Si prefieres elegir el modelo y no tener cupo, conecta **tu propia clave** en **Ajustes › Inteligencia Artificial**:

- **OpenAI** o **Anthropic (Claude)**: pega tu API key y elige el modelo por defecto.
- **Cualquier API compatible con OpenAI** (Groq, DeepSeek, OpenRouter…): pon su URL base en el campo *URL base* de OpenAI, con la key y el modelo de ese servicio. En la nube de Driony solo se admiten proveedores conocidos por https; si usas otro, pídenos que lo añadamos. En una instalación propia vale cualquier dirección, también Ollama en tu red.
- Pulsa **Probar conexión**: hace una llamada real, te dice si funciona y deja anotado el estado de tu clave (probada, rechazada, sin cuota).

Una sola modalidad por empresa. Guardar una clave pasa tu empresa a **tu propia clave**; borrarla vuelve a la **IA incluida**. Cada cambio (clave guardada, cambiada o borrada, modalidad, pruebas) queda en el **historial** de esa pantalla, con quién lo hizo y cuándo. Las keys se guardan cifradas y solo las usa tu empresa; con tu clave, cada respuesta se cobra en tu cuenta del proveedor, a su precio de lista y sin recargo de Driony.

**Sin IA no hay agente.** Si tu empresa usa su propia clave y esa clave falta, el proveedor la rechaza o se quedó sin cuota, Driony **no** vuelve solo a la IA incluida (eso cambiaría tu factura sin avisarte): el chat en autopilot pasa a **Pendientes** con el motivo «Falta la clave de IA», lo ves en Agentes y en el propio chat, y los toques de seguimiento que redacta la IA se omiten hasta que la arregles o la borres a propósito. Con la IA incluida, lo mismo ocurre al agotarse el cupo o su tope de seguridad, hasta el día 1 del mes.

## Crear un agente

La forma más fácil es **Agentes IA › Con ayuda** (o «Armar mi agente» en Primeros pasos): un asistente te hace cinco preguntas, qué vendes y a quién, cuál es su misión, qué puede hacer, cuándo te pasa el chat y cómo empieza, y con tus respuestas redacta las instrucciones. Al terminar puedes probarlo en una conversación simulada. Si tu agente principal todavía tiene las instrucciones genéricas, el asistente lo configura a él en vez de crear otro.

Para hacerlo a mano, **Agentes IA › Nuevo**. Arriba, siempre a la vista, están las tres decisiones clave:

- **Activo o pausado**: pausado, no responde a nadie.
- **Atiende**: dónde contesta en WhatsApp.
  - **Un número**: contesta en ese número.
  - **Todos los números sin agente propio**: es el agente **principal**. Solo hay uno: al elegirlo en otro agente, ese pasa a ser el principal y el anterior se queda con su número o sin ninguno. El principal no se puede borrar ni dejar sin números; se cambia eligiendo esta opción en otro agente.
  - **Ningún número**: no contesta en WhatsApp. Solo responde en los [embudos](/docs/embudos), páginas de Facebook o cuentas de TikTok donde lo elijas, y en **Probar conversación**. El editor te avisa de quién contesta en su lugar.

  Quién contesta un chat, en orden: el agente del embudo de la oportunidad del cliente, si tiene uno; si no, el del número; si no, el principal. Para comprobarlo en un chat real, pulsa **¿Por qué?** debajo de una respuesta de la IA en la bandeja: arriba sale el agente que la escribió.
- **En los chats nuevos**: **Responde solo** (contesta sin esperar a nadie; tu equipo puede tomar el control de cualquier chat) o **Te sugiere** (redacta cada respuesta y espera a que alguien la revise y la envíe). Ver [Bandeja](/docs/bandeja#copilot-y-autopilot).

Debajo, cinco pestañas:

- **Qué dice**: el nombre y **cómo debe atender**, lo más importante del agente: qué vendes y a quién, el tono de tu marca, qué no debe hacer y cuándo pasarte el chat. Si todavía tiene las instrucciones genéricas, te lo avisa y el asistente te las redacta.
- **Qué puede hacer**: lo que puede consultar para responder bien (productos y precios, tu información, la ficha del cliente) y lo que puede hacer en el CRM para ahorrarte trabajo (etiquetar, mover en el embudo, enviar fotos…).
- **Cuándo responde**: cuántos segundos espera antes de contestar (si el cliente escribe en varios mensajes seguidos, responde una sola vez a todo; recomendado 3 a 5), saludo automático, horario de atención y respuestas fijas por palabra clave.
- **Cómo escribe**: con **«Responder en varios mensajes cortos»**, las respuestas largas salen en dos a cuatro mensajes seguidos, con una pausa breve y el «escribiendo…» entre cada uno, en vez de un bloque; la IA aprende a separar ideas por párrafos y cada párrafo es un mensaje. En las respuestas fijas por palabra clave, una línea en blanco marca el corte.
- **Respuestas por palabra clave**: si el mensaje contiene alguna de las palabras («medios de pago», «cuenta», «transferencia»), el agente responde ese texto exacto sin pasar por la IA: ideal para cuentas bancarias, direcciones o políticas que no deben cambiar ni una letra. Cada respuesta admite **versiones con condiciones**, las mismas del bloque «Condición» de los flujos: país del cliente (por el prefijo de su teléfono: +51 Perú, +52 México…), etiqueta, etapa de su oportunidad, fuente, número de WhatsApp, un campo del contacto… Se prueban en orden y gana la primera que se cumple; quien no cumpla ninguna recibe el texto general. Las palabras se comparan sin distinguir mayúsculas; una respuesta por palabra tiene prioridad sobre todo lo demás y no mueve la conversación.
- **Cuándo te pasa el chat**: palabras que lo pasan a tu equipo al momento, cuánta señal necesita para apartarse por su cuenta (con «Nunca por su cuenta» intenta responderlo todo y solo se retira con esas palabras o si tú se lo pides en las instrucciones) y **qué le dice al cliente** al retirarse (para que no se quede en silencio). El chat queda como *Pendiente* y en él aparece una nota interna con el motivo.
- **Si cierras una conversación** («Cerrar y siguiente») y el cliente vuelve a escribir, se abre una nueva que hereda el modo de la IA de la anterior, y el agente sigue viendo los mensajes de los últimos 30 días del contacto para no perder el hilo.
- **Modelo y gasto**: qué IA usa, con lo que cuesta cada 1.000 respuestas con tu clave, y un **límite de gasto al mes**. En *Ajustes avanzados*, cuánto piensa antes de responder y cuántas consultas puede hacer por respuesta. Con la **IA de Driony** (sin clave propia) todos tus agentes responden con el mismo modelo de Driony y en modo «Rápido»: el modelo y el nivel que elijas quedan guardados y se usan cuando conectes tu clave, y la pantalla te lo dice. Con tu clave, cada modelo necesita la de su proveedor (los GPT, la de OpenAI; los Claude, la de Anthropic): si eliges uno sin esa clave, el agente responde con la clave que sí tienes y el modelo de Ajustes › Inteligencia Artificial, nunca con la IA de Driony, y la pantalla lo avisa. «Cuánto piensa» solo cambia algo en los modelos que razonan (los Claude y los GPT-5).

La barra de abajo te dice si hay **cambios sin guardar**, y al guardar lo confirma. Ctrl+S (Cmd+S en Mac) guarda desde cualquier pestaña. Si cambias de agente con cambios pendientes, Driony te avisa antes de perderlos.

**Ampliar** abre «Cómo debe atender» en grande, con lo importante señalado sobre el texto: los marcadores por rellenar como `[HORARIO]` (en ámbar), las acciones del agente que nombras (subrayadas; en ámbar ondulado si están desactivadas), los datos del cliente como `{{nombre}}` (en cian) y los títulos de sección (líneas en MAYÚSCULAS). El panel de la derecha lista esos elementos y «Siguiente por rellenar» recorre los marcadores uno a uno. Bajo el cuadro pequeño, una línea resume cuántos quedan.

En **Acciones del agente** cada acción aparece con su nombre en español y, debajo, el técnico. Haz clic en el texto, en la parte donde encaje, y elige una acción: se añade en su propia línea una frase lista para ajustar, por ejemplo «Si el cliente pide hablar con una persona, se molesta o no sabes la respuesta, despídete con amabilidad y usa handoff_to_human». Lo que la frase no puede saber por ti queda `[ENTRE CORCHETES]`, como la etiqueta o la etapa. Las que ya nombras dicen **Ya la usas**: un clic te lleva a donde aparecen (otro clic, a la siguiente) y el **+** añade otra frase.

## Asistente de redacción

No hace falta saber escribir un *system prompt*. Junto al campo de instrucciones (y junto a la bienvenida y al mensaje fuera de horario) hay un botón **Asistente**:

1. Cuentas qué vendes y a quién, el objetivo del agente (vender, agendar, dar soporte…) y el tono.
2. El asistente propone unas instrucciones completas: rol, objetivo, tono para WhatsApp, cuándo usar cada herramienta que tengas activada, límites, cuándo pasar a una persona y ejemplos.
3. Pides ajustes en el chat («más corto», «de usted», «añade los horarios») y, cuando te convenza, pulsas **Usar este texto**. Nada se guarda hasta que guardas el agente.

Usa tu propio modelo (Ajustes › Inteligencia Artificial) y conoce tu contexto real: catálogo, base de conocimiento, etapas del embudo y herramientas del agente, así que no inventa nombres de herramientas ni productos. Lo que no sabe lo deja marcado entre corchetes, como `[HORARIO]`, para que lo rellenes. También sirve para cualquier otro texto: un guion de ventas, una respuesta a una objeción o un mensaje de seguimiento.

### Contarlo en un audio

Si te resulta más fácil hablar que escribir, en el asistente, en «Qué vendes y a quién», en los detalles y en el chat (también en **Con ayuda**) tienes **Contarlo en un audio** (o **Dictar**): grabas hasta cinco minutos contándolo como se lo contarías a alguien nuevo en tu equipo, pulsas **Listo** y el texto aparece en el cuadro. También puedes **subir un audio** que ya tengas, por ejemplo una nota de voz de WhatsApp (MP3, M4A, OGG u OPUS, hasta 20 MB). Revisa el texto antes de enviarlo: puede que haya entendido mal un nombre o un precio. El audio no se guarda.

Se pasa a texto con OpenAI, igual que los audios de tus clientes: con tu clave de OpenAI si la tienes; si no, con la IA incluida de Driony. En **Consumo de IA** cuenta como «Asistente de redacción»; un minuto de audio cuesta menos de un centavo de dólar.

## Herramientas y acciones

| Consulta | Qué hace |
|---|---|
| `search_knowledge` | Busca en tu [base de conocimiento](#base-de-conocimiento) |
| `search_products` | Busca en tu catálogo (Productos), también por sus características como talla o color |
| `search_contact` | Lee la ficha del contacto |
| `check_availability` | Consulta las horas libres de la [agenda](/docs/agenda) para un servicio |

| Acción | Qué hace |
|---|---|
| `add_tag` / `remove_tag` | Etiqueta al contacto |
| `mark_lead` | Clasifica al contacto como **potencial**, **compra** o **perdido** y lo coloca en la etapa que tiene ese rol en su embudo (ver [Embudos](/docs/embudos)) |
| `move_deal_stage` | Mueve (o crea) su oportunidad a una etapa concreta del embudo predeterminado |
| `update_contact` | Actualiza la ficha y los campos personalizados |
| `assign_to_seller` | Asigna un vendedor |
| `send_product_image` | Envía la foto de un producto |
| `send_product_file` | Envía un [archivo de un producto](#enviar-archivos-de-un-producto): su brochure, su temario, su ficha |
| `book_appointment` / `reschedule_appointment` / `cancel_appointment` | Reserva, mueve o cancela una cita del contacto en la [agenda](/docs/agenda) |
| `handoff_to_human` | Pasa la conversación a una persona: el chat queda *Pendiente*, el equipo recibe un aviso y una nota con el motivo, y el cliente recibe la despedida que la IA redactó (o el aviso configurado en *Cuándo te pasa el chat*) |

En Copilot las acciones quedan pendientes de aprobación; en Autopilot se aplican solas.

### Enviar archivos de un producto

Para que la IA mande el brochure o el temario **como archivo**:

1. En **Productos › Campos** crea un campo de tipo **Archivo** («Brochure»). Puedes tener varios.
2. En cada producto, **sube el archivo** o **pega un enlace público**. Por la API, la importación o una tienda conectada entra el enlace.
3. En el agente, en **Qué puede hacer**, activa **Enviar archivos de productos**. Aparece cuando algún producto activo tiene un archivo.

El cliente lo recibe con un nombre claro, como «Brochure Power BI.pdf». La IA sabe qué archivos tiene cada producto, pero no ve la dirección: no puede pegarla ni inventarla. Si quieres que lo mande en un caso concreto, dilo en *Cómo debe atender*: «Si pide el brochure o más información, envíale el archivo con `send_product_file`».

- **Enlaces.** Se comprueban al enviar. Los de Google Drive, Google Docs y Dropbox se convierten solos a descarga directa, siempre que el archivo sea público. Si el enlace abre una página en vez de un archivo, pesa más de 16 MB o no responde, al cliente le llega **el enlace en un mensaje** y la IA lo sabe, para que no diga que mandó un archivo. En «¿Por qué?» ves qué pasó.
- **Canales.** Como archivo en WhatsApp y Messenger. Instagram y TikTok no admiten documentos: ahí va el enlace, y si el archivo está subido a Driony, la IA ofrece mandarlo por otro medio.

### Botones en las respuestas

Con **Responder con botones** activado en *Qué puede hacer*, cuando la respuesta de la IA **termina en una pregunta para elegir** (sí o no, o entre pocas opciones), las opciones le llegan al cliente como botones. Son automáticos; para decidir tú cuándo y cuáles, escríbelo en **Cómo debe atender** con la palabra **botón** o **botones**:

> Cuando el mensaje ofrezca el brochure, usa los botones «Sí, sepárame» y «Ver brochure».
>
> Cuando preguntes si quiere separar su cupo y el mensaje no ofrezca el brochure, usa los botones «Sí, sepárame» y «Tengo dudas».
>
> Nunca uses botones cuando le pidas su nombre o su correo.

Cada regla va en su línea y manda sobre lo automático: si la pregunta encaja, salen exactamente esos textos. La regla se decide leyendo **el mensaje que va a salir**, no el producto: por eso conviene describir el mensaje («cuando ofrezca el brochure») y no el dato («si el curso tiene brochure»). Cada botón tiene hasta 20 caracteres y hay de 2 a 10 opciones (con más de 3, WhatsApp las muestra como lista). Se toman las 12 primeras reglas, de hasta 300 caracteres. Cuando el cliente pulsa uno, la IA lo lee como si lo hubiera escrito: «Ver brochure» le pide el archivo.

## Copiloto, memoria y conocimiento que aprende

Además del agente que responde solo, Driony ayuda a tu equipo dentro de cada conversación. Todo esto funciona con la **IA incluida** de tu plan (sus tokens salen del mismo cupo que el agente) o, si la conectaste, con **tu propia clave** de OpenAI o Anthropic (Ajustes › Inteligencia Artificial): Driony no vende créditos ni pone margen sobre tu clave, pagas a tu proveedor al precio de su lista.

**En el cuadro de mensaje**, el botón de la varita reescribe tu borrador: mejorar la redacción, más cordial, más formal, más corto, corregir ortografía, o traducir al idioma del cliente (lo detecta de sus mensajes), al inglés o al portugués. Si no te convence, **Deshacer** devuelve tu texto.

**En Detalles** del chat, el panel **Copiloto** te da:

- **Resumir conversación**: qué quiere el cliente, datos clave y el siguiente paso, para retomar un chat largo en diez segundos.
- **Preguntar**: «¿qué le ofrecimos?», «¿cuánto presupuesto tiene?», «redáctale un seguimiento». Responde con la ficha, las oportunidades, las notas internas, las conversaciones anteriores y tu base de conocimiento. Cualquier respuesta se puede usar como borrador.
- **Memoria del cliente**: un resumen y los datos útiles de todas sus conversaciones (preferencias, productos que le interesan, presupuesto, compromisos). Se actualiza sola al cerrar cada conversación y **el agente automático la usa** para no volver a preguntar lo que ya sabe.

**En Conocimiento**:

- **Preguntas sin respuesta**: la IA lee las conversaciones de los últimos 30 días y detecta lo que tus clientes preguntan y tu conocimiento no cubre, con una respuesta propuesta a partir de cómo contestó tu equipo. La revisas, la apruebas y el agente la usa desde ese momento. Lo que descartas no vuelve a salir.
- **Importar web**: pega la dirección de tu página de preguntas frecuentes o de envíos (y, si quieres, las del mismo sitio que enlaza). Volver a importarla la actualiza.
- Indexar y buscar en el conocimiento usa **OpenAI**: tu clave de OpenAI si la tienes; si no, también cuando tu clave es solo de Anthropic, la IA incluida de Driony dentro de su tope de seguridad (ver [qué credencial usa cada función](/docs/planes#que-credencial-usa-cada-funcion)). Si cambias de proveedor, Driony te avisa para **reindexar** los documentos.

## Qué sabe del catálogo y del contacto

Con catálogos grandes (cientos de productos) el agente no los lee todos de golpe: **busca** por palabras sueltas, sin importar tildes ni mayúsculas, en el nombre, la descripción, el SKU y los campos visibles, y recibe los más parecidos con su detalle más la lista de nombres del resto. Si un producto no aparece, suele ser por el nombre: ponle el nombre con el que lo pide la gente (y, si hace falta, palabras clave en la descripción), y evita nombres genéricos repetidos como «Producto 1».

- **Catálogo**: el agente lee los productos con `search_products`: nombre, precio (en la moneda del cliente), descripción y los **campos del catálogo** que tengan activado «lo usa el agente de IA» (temario, duración, modalidad…). Las instrucciones le dicen qué campos existen; para que los use, pídeselo: «cuando pregunten por el temario, consulta el curso y cítalo tal cual». Escribir «[Temario]» en las instrucciones no sustituye nada: hay muchos productos y es el agente quien busca el que toca.
- **Contacto**: conoce el nombre, teléfono, país, moneda y los **campos personalizados del contacto** con valor, y puedes insertarlos en las instrucciones con `{{nombre}}`, `{{telefono}}`, `{{pais}}`, `{{moneda}}` o `{{clave del campo}}` (en «Cómo debe atender», el desplegable *Cómo nombrar sus acciones* lista las claves). Si a un cliente le falta ese dato, el agente lee «(sin dato)» y no se lo inventa.

### De dónde viene el cliente

El agente sabe por dónde llegó y lo usa para entender de qué le hablan: si escribe solo «info», se refiere a lo de su campaña. Lo sabe sin que configures nada:

- **Anuncio que abre WhatsApp**: el titular, el texto y el saludo del anuncio.
- **Formulario de Meta**: el formulario, la campaña y el anuncio.
- **UTM**: los de la URL del anuncio, los de un enlace `wa.me`, los que mande tu web por la [API](/docs/api) o los **parámetros de seguimiento** de un formulario de Meta (en el formulario, *Configuración › Agregar parámetro*).

Son datos internos: se le pide que no los mencione ni los copie al cliente. Si quieres decidir tú la respuesta, tienes las variables `{{campana}}`, `{{anuncio}}`, `{{formulario}}`, `{{fuente}}`, `{{utm_source}}`, `{{utm_medium}}`, `{{utm_campaign}}`, `{{utm_content}}` y `{{utm_term}}`:

> El cliente viene de la campaña {{utm_campaign}}.
>
> Si la campaña contiene «powerbi», preséntale Power BI. Si contiene «excel», preséntale Excel avanzado.
>
> Si dice «(sin dato)», pregúntale qué curso le interesa.

- **Si el producto va en otro UTM**, usa esa variable: «El curso por el que llegó este cliente es: {{utm_term}}. Si hay un curso, búscalo con `search_products` y preséntalo directo». Conviene escribirlo como el nombre del producto en tu catálogo: de un código la IA no sabe qué producto es.
- **El más reciente manda.** Si un cliente vuelve por otra campaña, el agente y las condiciones «UTM con que llegó» de los flujos usan la última; la primera se conserva en su ficha y en la API para tus reportes.
- `{{campana}}` es la campaña de Meta del formulario y, si no hay, el `utm_campaign`.
- **Para probarlo**, en *Probar conversación* escribe un `utm_campaign` o un `utm_term` en «Probar como».
- **Para que cada campaña tenga su propio agente**, llévala a un embudo con su agente: en **Configurar** de cada formulario de Meta, o con un flujo que cree la oportunidad según el UTM.

### Datos del cliente en los mensajes fijos

Las mismas variables funcionan en los textos que se envían tal cual, sin pasar por la IA: el **saludo automático**, el **mensaje fuera de horario**, las **respuestas por palabra clave** (y sus versiones), lo que dice **al pasarte el chat** y los **seguimientos de texto fijo**. «¡Hola {{nombre}}!» le llega a Ana como «¡Hola Ana!».

- Junto a cada uno de esos cuadros, **Insertar dato del cliente** pone la variable donde está el cursor; también puedes escribir `{{` y elegirla de la lista con las flechas y Enter.
- Debajo ves cómo le llega a un cliente de ejemplo y a uno del que no sabemos nada.
- **Si falta el dato, la variable se quita y la frase se arregla**: «Hola {{nombre}}, gracias por escribirnos» llega como «Hola, gracias por escribirnos». Al cliente nunca le llegan llaves, tampoco si la variable está mal escrita (la pantalla te lo avisa).
- Para elegir qué poner cuando falta, escríbelo tras una barra: `{{nombre|amigo}}` llega como «Hola amigo» si no sabemos su nombre.
- Mayúsculas y tildes dan igual: `{{País}}` y `{{pais}}` son lo mismo. Sirven la clave del campo o su nombre.
- Si el contacto se guardó sin nombre (con su número como nombre), `{{nombre}}` cuenta como vacío. A quien escribe por Messenger, Instagram o TikTok no se le conoce el teléfono ni el país.

## Pedirle que pase el chat

Para que el agente se retire en un caso concreto, díselo en **Cómo debe atender** y deja activada la acción `handoff_to_human` en *Qué puede hacer*. Cada acción muestra ahí su **nombre técnico** (con botón de copiar), que es como la IA la conoce; en «Cómo debe atender» hay un desplegable, *Cómo nombrar sus acciones en las instrucciones*, con los de las acciones activas. Por ejemplo, para comprobantes de pago:

> Cuando el cliente envíe un comprobante de pago (foto o captura de una transferencia, Yape, Plin o similar): agradece, dile que una persona del equipo validará el pago en unos minutos y usa la herramienta handoff_to_human con el motivo «comprobante de pago». No confirmes tú el pago ni des por entregado nada.

Al hacerlo, el cliente recibe exactamente lo que la IA redactó («Gracias, una persona validará tu pago…»), la conversación pasa a **Pendiente** con la marca **«Pasado a humano»** en la lista de la bandeja, al abrirla aparece un aviso con el motivo y el botón **Atender**, el equipo recibe un aviso emergente y queda una nota interna. Desde ese momento la IA deja de responder sola en ese chat (pasa a Copilot: sugiere, no envía) hasta que alguien lo atiende: responder, pulsar *Atender* o cerrarlo quita la marca.

Como la IA puede decirlo y olvidarse de llamar a la herramienta, para los comprobantes conviene además la opción **«Pasar siempre el chat cuando el cliente envía una imagen o un documento»** (*Cuándo te pasa el chat*): es determinista. La IA sigue contestando lo que le indicaste y el chat pasa a Pendiente en cuanto llega la imagen. Si la IA se retira sin haber escrito nada (reglas de escalado, cliente molesto, no sabe qué responder), el cliente recibe el aviso de *Cuándo te pasa el chat*.

Las **imágenes** que manda el cliente se describen antes de responder (con la misma IA del agente), así la IA sabe que es un comprobante, una foto del producto o una captura; los audios se transcriben. Hace falta IA con visión: la incluida de Driony, o tu clave de OpenAI o Anthropic (con OpenAI, la foto se describe con gpt-4.1-mini, que cobra una imagen a unos 400 tokens; gpt-4o-mini cobra la misma foto a casi 3.000). Si la clave viene de un proveedor intermedio que no la ofrece, la IA verá «[imagen]» sin descripción, lo dirá y pedirá al cliente que le cuente qué es; en el registro de la API aparece el aviso «El modelo de visión no vio…».

## Precios en varias monedas

Cada producto tiene un **precio base** y, si quieres, **precios en otras monedas** (Productos › Editar › *Añadir precio en otra moneda*, o columnas `price_USD`, `price_MXN`… al importar desde Excel o CSV). No hay conversión automática: el precio en cada moneda lo decides tú.

A cada contacto se le cotiza en la moneda de **su país**, que Driony deduce del prefijo de su teléfono (+52 → México → MXN, +51 → Perú → PEN). Si hace falta otra, se cambia en su ficha (*País y moneda para cotizar*).

- El agente recibe los precios de `search_products` ya en la moneda del cliente. Si un producto no tiene precio en esa moneda, le da el precio base con su moneda, sin inventar una conversión.
- Las oportunidades nuevas nacen en la moneda del contacto, y se puede cambiar en su detalle. Cada columna del embudo suma por separado cada moneda.

## Campos del catálogo

El catálogo sirve para productos, servicios, talleres o lo que vendas. En **Productos › Campos** decides qué datos guardas de cada uno: talla o color, duración o modalidad, fecha de inicio y cupos… No hay campos fijos.

- **Tipos**: texto corto, texto largo, número (con unidad, como `min` o `cupos`), fecha, hora, sí / no, una opción de una lista, varias opciones, enlace y archivo.
- **Configuración de cada campo**: texto de ayuda, obligatorio, si se ve en la tarjeta y si lo usa el agente de IA. Apaga esto último para datos internos, como el costo o el proveedor. El orden se cambia con las flechas.
- **Ideas para empezar**: grupos listos para tiendas, servicios, talleres y uso interno. Un clic los añade y después se pueden cambiar.
- **Importar desde Excel o CSV**: añade una columna con el nombre del campo; la plantilla de ejemplo (Excel o CSV, con productos en varias monedas) ya la incluye. Las columnas van en inglés (`name`, `sku`, `price`, `currency`, `description`, `image_url`, `active`), aunque los títulos en español también se reconocen. Las fechas aceptan `31/12/2026`, los sí / no aceptan `si` o `no`, y en las listas se rechaza un valor que no esté entre las opciones.
- **Agente de IA**: recibe los campos visibles en `search_products` y también encuentra productos por ellos (por ejemplo, «taller los jueves»). Los campos internos no se le envían ni se usan para buscar.
- Si borras un campo, sus valores no se pierden: reaparecen al volver a crearlo con el mismo nombre.

## Audios, imágenes y stickers

Cuando un cliente manda un **audio**, Driony lo transcribe; una **imagen**, la describe (si es un comprobante, un pedido o una captura, saca los datos que se leen). Los **stickers** no se describen: el agente ve «[sticker]» y sigue la conversación, porque describirlos cuesta lo mismo que una foto y no aporta nada a la venta. Eso se guarda bajo el mensaje en la bandeja, con el icono de la IA, y el agente lo lee como parte de la conversación: responde a lo que dijo el audio o a lo que muestra la foto, en vez de ignorarlo.

- La transcripción usa **OpenAI**: tu clave de OpenAI si la tienes; si no, la IA incluida de Driony, también cuando tu clave es solo de Anthropic (es la única mezcla entre las dos modalidades, cuenta en el tope de seguridad de la IA incluida y no en el cupo de conversaciones). Las imágenes se describen con cualquiera de los dos proveedores. En una instalación propia sin clave de OpenAI, los audios no se transcriben.
- Con tu clave se cobra en tu cuenta del proveedor; en los dos casos aparece en **Consumo de IA** como «Audios e imágenes de clientes», separado según de quién era la clave. Un audio de un minuto cuesta menos de un centavo de dólar.
- Los videos y documentos no se interpretan todavía; el agente ve que llegaron.

## Seguimientos

Si el cliente deja de responder, el agente puede escribirle solo, hasta cuatro veces, con la cadencia que decidas (por ejemplo: a las 2 horas, al día siguiente y a los 3 días). Se configura en el agente, pestaña **Cuándo**, sección **Seguimientos**.

En cada toque eliges qué se envía:

- **Lo redacta la IA**: una o dos frases que retoman lo último que hablaban («¿te decidiste por la talla 42?»). Puedes darle un objetivo («recordarle la cotización»). Cuesta una llamada breve al modelo.
- **Un texto fijo**: siempre el mismo, sin IA.
- **Una plantilla aprobada por Meta**: obligatoria cuando han pasado 24 h o más desde el último mensaje del cliente, porque WhatsApp no permite otra cosa. Si la plantilla tiene `{{1}}`, va el nombre del contacto.

Lo que no hace falta configurar:

- Se detiene en cuanto el cliente responde, si la oportunidad se gana o si cierras el chat. Si una persona del equipo escribe, la secuencia vuelve a empezar desde el primer toque.
- Por defecto solo actúa en los chats que atiende la IA. Marca **También en los chats que lleva una persona** para que haga seguimiento cuando un vendedor escribió y el cliente no contestó.
- Con horario de atención activo, los toques esperan a que abra.
- Un toque de texto o de IA que caiga fuera de la ventana de 24 h se salta; el siguiente que sea plantilla sí sale.
- En la bandeja, el chat muestra «Seguimiento 2 en 3 h»; con la × lo cancelas para ese cliente hasta que vuelva a escribir.

El gasto aparece en **Consumo de IA** como «Seguimientos automáticos».

## Base de conocimiento

En **Conocimiento** subes documentos (precios, condiciones, preguntas frecuentes, guías). Se trocean y se indexan para que el agente responda **con tu información** en vez de inventar. Cada consulta suma un poco de tiempo y de gasto; activa la herramienta solo en los agentes que la necesiten.

## Límite de gasto

Cada respuesta registra sus tokens y su coste. En el agente ves el gasto del mes y puedes poner un **tope mensual**: al alcanzarlo, la IA deja de responder con ese agente hasta el día 1 y las conversaciones pasan a tu equipo.

- **Con tu propia clave** el tope se elige en dólares (USD 5, 20, 50 al mes u otra cantidad) y se convierte a tokens según el modelo: sin sorpresas en la factura del proveedor.
- **Con la IA de Driony** se elige en tokens, como parte de los de tu plan (10 %, 25 % o 50 %, u otra cantidad), y sirve para **repartirlos entre agentes**: si uno llega a su tope, los demás siguen con el resto. Sin tope, un agente puede usar todos los tokens del plan.

## Playground

Antes de activar un agente, pruébalo en el **Playground**: una conversación simulada donde ves la respuesta, las herramientas que usó, los tokens y el coste de cada turno.

## Simulador de conversaciones

En el mismo cajón de **Probar agente** hay dos modos. **Escribir yo** es el Playground de siempre. **Simular clientes** pone a una IA a hacer de cliente, para ver cómo responde tu agente sin escribir tú cada mensaje:

1. Elige a qué clientes simular (hasta 5 por tanda): el que pregunta el precio, el que quiere agendar, el indeciso, el molesto, el que pide hablar con una persona, el que pregunta algo que no está previsto, o uno que describas tú.
2. Elige cuántos mensajes escribirá el cliente en cada conversación (4, 6 u 8).
3. Antes de empezar ves el **gasto estimado** en tokens; al terminar, lo que gastó de verdad.

Las conversaciones corren una detrás de otra y se ven en vivo. En cada una ves lo que respondió el agente, las herramientas que usó, las acciones que habría hecho (no se aplican) y si pasó el chat a una persona. Con **Detener** se corta cuando quieras.

No se envía nada por WhatsApp ni se crea o cambia ningún contacto. Sí **gasta tokens**, por los dos lados (el cliente simulado y tu agente): salen de tu IA de Driony o los cobra tu proveedor si usas tu clave, y aparecen en **Consumo de IA** como «Simulador de conversaciones».

## Mejorar agente

Junto a **Probar conversación**, el botón **Mejorar** mide cómo atiende tu agente con una batería de casos, deja que la IA proponga cambios en sus instrucciones y compara el antes y el después con los mismos casos. Una sola prueba engaña: el mismo agente contesta distinto cada vez. Por eso aquí cada caso se repite varias veces y se cuenta.

1. **Casos de prueba.** La primera vez aparecen los clientes de siempre del simulador (vienen marcados los de venta). Puedes escribir los tuyos con **Nuevo caso**, o sacarlos de un chat real con **Añadir desde un chat real**: una IA lee el chat y redacta la situación del cliente, sin su nombre ni su teléfono, y tú la revisas antes de guardarla. También puedes hacerlo desde **Revisión de chats**, con **Añadir a los casos de prueba** en cualquier chat marcado «Revisar» o «Mal».
2. **Qué hacer.** Elige cuántas veces se repite cada caso (1, 3 o 5), cuántos mensajes escribe el cliente (4, 6 u 8) y si solo quieres **medir** cómo atiende hoy o **medir y proponer mejoras** (de 1 a 3 vueltas; cada vuelta parte de la mejor versión hasta el momento). Antes de empezar ves el gasto estimado en tokens.
3. **Resultado.** Tres conteos, antes y después: **Atendió bien**, **Inventó un dato** y **Llegó a buen fin**, en total y por caso, con **ver chats** para leer cada conversación con lo que marcó la revisión. Debajo, **Qué cambió** (cada cambio, por qué y por qué caso) y las **instrucciones propuestas**, con lo añadido y lo quitado resaltado.

La propuesta solo dice «**Mejora clara**» si gana al menos un 10 % y no inventa más datos que antes. Si la diferencia es pequeña, dice «sin diferencia clara»: puede ser azar, y es mejor no aplicarla o repetir con más repeticiones. La IA nunca añade datos de tu negocio (precios, fechas, descuentos, políticas) ni toca los datos entre « », los huecos entre [ ] o las herramientas: solo corrige o añade reglas de cómo atender. Los cambios que no cumplen se descartan solos.

El agente **solo cambia cuando pulsas «Aplicar al agente»**. Las instrucciones anteriores quedan en **Versiones anteriores**, desde donde puedes restaurarlas. Ahí también se guarda la versión anterior cada vez que editas las instrucciones a mano. Se conservan las últimas 20.

La medición corre en el servidor: puedes cerrar la ventana y volver para ver el avance o el resultado. Hay una sola a la vez por empresa, y la puedes **Detener**. Si la IA se queda sin tokens a mitad, se detiene con lo que llevaba y te lo dice. No se envía nada por WhatsApp. Sí **gasta tokens**, y bastantes (una medición de 3 casos con 3 repeticiones y una propuesta ronda los 300 000–400 000): aparecen en **Consumo de IA** como «Mejora del agente». Solo pueden usarla los administradores.
