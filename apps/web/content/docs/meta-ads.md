# Anuncios y leads de Meta

Driony recoge los contactos que llegan desde Facebook e Instagram por dos caminos, y guarda de dónde vino cada uno.

## Anuncios click-to-WhatsApp

Son los anuncios cuyo botón abre una conversación de WhatsApp. No hay que configurar nada: cuando alguien toca el anuncio y escribe, Meta adjunta a ese mensaje los datos del anuncio y Driony los guarda.

**En la bandeja:**

- El mensaje que llegó tras el clic lleva encima una tarjeta con el anuncio: titular, texto, el **saludo** que WhatsApp le mostró al cliente antes de escribir y el enlace «Ver anuncio».
- La fila de la conversación lleva la marca **Anuncio**.
- En **Detalles › Origen** ves el anuncio de este chat y, si fue otro, el primer anuncio que trajo al cliente.

**Si el cliente ya tenía el chat abierto** y vuelve tocando otro anuncio, también se registra: el mensaje lleva su tarjeta y el chat pasa a contar con ese último clic (es el que vale para las conversiones). Un flujo «Llega desde un anuncio», si tienes uno activo, arranca también en ese caso.

**El agente de IA** sabe por qué anuncio llegó el cliente (titular y texto) y qué saludo le mostró, así entiende un «¿cuánto cuesta?» sin más contexto y no repite el saludo.

**En el contacto** se guarda la primera vez:

- **Procedencia**: *anuncio*, con el titular o el identificador del anuncio;
- la **fuente** «Anuncio de Meta»;
- los parámetros **utm_*** que pongas en la URL del anuncio o en el texto prellenado del enlace `wa.me`.

Todo eso sale también por la [API pública](/docs/api) (`origin`, `utm`).

Lo que Meta envía y lo que no:

- El nombre de la **campaña** y del conjunto de anuncios no viene en el mensaje: solo el identificador del anuncio. Leerlos exige el permiso `ads_read` sobre tu cuenta publicitaria.
- Los anuncios en **Estados de WhatsApp** no traen el identificador del clic (`ctwa_clid`): el chat se marca como anuncio, pero no puede devolver conversiones.
- Al pulsar un **botón** no viaja el anuncio: solo en mensajes de texto, foto, audio, ubicación y similares.

## Lead Ads (formularios)

Los formularios de clientes potenciales de Facebook e Instagram entran al CRM en el momento en que alguien los envía:

1. **Ajustes › Canales › Formularios de Facebook → Conectar con Facebook**: autoriza con la cuenta que administra la página y marca las páginas.
2. **Elige los formularios que entran.** Driony lee los formularios de cada página y te los muestra: los activos salen marcados, los archivados no. Lo que dejes sin marcar queda apagado (sus leads no entran). Ahí mismo decides qué pasa con los **formularios que crees más adelante**: entran solos, como la página, o esperan a que los actives en la lista. Lo cambias cuando quieras en la lista de formularios («Nuevos»).
3. La **fuente** de esos leads es, si no eliges otra, **Formulario de Facebook** (se crea sola con el primer lead, también para los de Instagram). Si quieres, añade una **plantilla de bienvenida**: como el lead no te ha escrito, la ventana de 24 horas está cerrada y solo una plantilla aprobada puede abrir la conversación.
4. En **Oportunidad para sus leads** elige en qué etapa (de cualquier embudo) entra la oportunidad de cada lead, o «No crear oportunidad».
5. En **Formularios**, cada formulario puede ir a su propia etapa («Inscripción a cursos» a *Inscritos*, «Promo» a *Nuevo*) o apagarse (desmarcado, sus leads se ignoran). **Actualizar lista** vuelve a pedir los formularios a Meta.
6. **Configurar** abre la ventana del formulario, con todo en un sitio. Nada cambia hasta que pulsas **Guardar**:
   - **Dónde entran**: su etapa, su fuente (la de la página, la automática u otra: «Inscripción a cursos» con la fuente *Cursos*) y sus etiquetas, que se suman a las de la página. **Nueva etiqueta** la crea ahí mismo.
   - **A dónde va cada respuesta**: cada pregunta sale con el tipo que tiene en Meta (nombre, teléfono, opción múltiple, fecha…) y un ejemplo del último lead. Elige *Nombre*, *Teléfono*, *Email*, uno de tus campos o *No guardar*. **Crear campo…** crea el campo con el nombre de la pregunta, el tipo que le toca (una pregunta de opción múltiple se vuelve una lista con esas opciones) y una clave propuesta que puedes cambiar antes de crearlo (después ya no cambia). Sin elegir, cada respuesta va sola por el nombre de la pregunta: las estándar de Meta (nombre, teléfono, correo) a su sitio y el resto a un campo con ese nombre, si lo tienes; si no, se guarda pero no sale en la ficha. Si el formulario pide el WhatsApp con una pregunta propia, llévala a *Teléfono*: sin teléfono, el lead se queda pendiente.
   - **Así quedaría el contacto**: con las respuestas del último lead y lo que has elegido, ves el nombre, el teléfono, la fuente, las etiquetas, la oportunidad y cada campo antes de guardar.
   - **Leads recibidos**: los leads de ese formulario con su estado (procesado, sin teléfono, error). **Reprocesar** vuelve a pasar uno con la configuración actual: tras corregir a dónde va el teléfono, los pendientes se convierten en contactos; uno que falló se vuelve a leer en Meta. **Importar leads anteriores** trae los que Meta todavía guarda (conserva los de los últimos 90 días) y que aún no estén en Driony, con su fecha original.

Cada lead crea (o actualiza) el contacto con las respuestas del formulario. Si el cliente ya tiene una oportunidad en curso no se crea otra; si estaba ganada o perdida, se abre una nueva. Al entrar en la etapa corren sus automatizaciones y sus conversiones de Meta, como si la hubieras movido tú. Los leads **importados o reprocesados** son la excepción: pueden ser de hace semanas, así que crean o actualizan el contacto y su oportunidad, pero no reciben la plantilla de bienvenida ni arrancan flujos ni automatizaciones de etapa.

La lista de formularios y sus preguntas las da Meta con el permiso para administrar los anuncios de la página, que se pide al conectar. Si no lo diste, o conectaste la página antes de que Driony lo pidiera, aparecen solo los formularios de los que ya llegó algún lead, con las preguntas de esos leads, y la lista te ofrece **Volver a autorizar**: deja marcada la página y acepta todos los permisos para verlos todos. Un formulario nuevo entra como indique la página hasta que lo configures.

Con cada lead se guardan el **formulario** y, si Meta los da con el permiso de tu página, el **anuncio** y la **campaña**. En **Ajustes › Canales › Formularios de Facebook** ves cada lead recibido y si se procesó bien.

### Cuando el lead escribe por WhatsApp

Muchos formularios terminan con un botón para escribir por WhatsApp. Meta no une el formulario con el chat: la unión es el **teléfono**. Driony lo hace solo:

- Si el formulario trae el número **sin prefijo de país**, se le pone el del número de WhatsApp de tu empresa.
- Si escribe por WhatsApp **antes** de que llegue el lead, el contacto pasa de la fuente «WhatsApp» a «Formulario de Facebook». Una fuente que hayas puesto a mano no se toca.
- **México y Argentina**: WhatsApp identifica esos móviles con «+52 1» y «+54 9», y los formularios suelen traerlos sin ese dígito. Driony los reconoce como el mismo número: el chat cae en el contacto del lead, que pasa a tener el número de WhatsApp.

En el chat, **Detalles › Origen** muestra el formulario que llenó (con su campaña y anuncio si los hay), y el agente de IA sabe que ya dejó sus datos para no volver a pedírselos.

## Atribución en tus métricas

En la ficha del contacto distinguimos dos cosas:

- **Fuente**: comercial, la que tú defines y usas para repartir vendedores (Ajustes › Fuentes).
- **Procedencia**: técnica, por qué vía entró (anuncio, WhatsApp, webhook, importación) y con qué detalle (número, nombre de la clave de API, anuncio).

Con la API `stats/*` puedes cruzar fuente, embudo y vendedor en tu propio panel.

## Conversiones de anuncios

Driony devuelve a Meta las etapas del embudo de los chats que vinieron de un anuncio click-to-WhatsApp (Conversions API for Business Messaging), con el `ctwa_clid` del clic, para que las campañas optimicen hacia clientes de verdad y no solo hacia clics.

En **Ajustes › Integraciones › Conversiones de anuncios (Meta)** activa cada número de WhatsApp. Al activarlo, Driony obtiene (o crea) el *dataset* de su cuenta de WhatsApp Business.

Qué se envía lo decides **etapa por etapa**: pulsa el engranaje de la etapa (en la columna del tablero del embudo o en **Ajustes › Embudos y etapas**) y, en «Conversiones de Meta», añade eventos. Un embudo nuevo arranca con **Lead interesado** en la etapa Potencial y **Compra** (con el valor y la moneda de la oportunidad) en la Ganada, y en esas etapas el panel te recomienda el que toca si falta.

Casi todos los negocios usan solo estos tres:

| Evento | Qué significa | Qué hace Meta |
|---|---|---|
| **Lead interesado** (`LeadSubmitted`) | Mostró interés real: pidió precio, dejó sus datos o quiere comprar. | Busca más gente así. |
| **Lead calificado** (`QualifiedLead`) | Tu equipo confirmó que es un buen cliente potencial. | Busca clientes de más calidad, no solo más chats. |
| **Compra** (`Purchase`) | Compró, con el valor de la oportunidad. | Busca compradores parecidos y mide cuánto vendieron tus anuncios. |

Para tiendas hay también *Vio un producto*, *Añadió al carrito*, *Empezó a pagar*, *Carrito abandonado* y los de pedido (creado, enviado, entregado, cancelado, devuelto), y para opiniones *Dio una valoración* y *Dejó una reseña*. Son todos los que Meta admite en WhatsApp; eventos con nombre propio no los acepta.

**La compra necesita el valor.** Al pasar a Ganada una oportunidad sin valor, el tablero te pregunta «¿Cuánto fue la venta?». Si la marca la IA o eliges «Ganada sin valor», la compra no se envía con 0: espera, y sale sola en cuanto le pongas el valor a la oportunidad (en la tarjeta de Integraciones aparece como «Espera el valor»).

Cuando una oportunidad cuyo chat vino de un anuncio llega a una etapa, se envían sus eventos, cada uno una sola vez por oportunidad, con el **último clic** del cliente que traiga `ctwa_clid`. El agente de IA mueve a Potencial y Ganada con `mark_lead`; el resto, con las automatizaciones o a mano. En la tarjeta de Integraciones ves los últimos eventos enviados y puedes reintentar los que fallaron. Los chats que no vinieron de un anuncio no envían nada. Requiere que la app de Meta tenga el permiso `whatsapp_business_manage_events`.

## Ventana gratuita de los anuncios

Cuando respondes en 24 horas a un chat que llegó de un anuncio click-to-WhatsApp, Meta abre una ventana de entrada gratuita: desde el 1 de octubre de 2026 dura hasta 7 días y en ella las plantillas no se cobran. Los mensajes libres (sin plantilla) siguen necesitando la ventana normal de 24 horas desde el último mensaje del cliente.
