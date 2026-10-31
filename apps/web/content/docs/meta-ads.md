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

1. **Ajustes › Canales › Formularios de Facebook → Conectar con Facebook**: autoriza con la cuenta que administra la página.
2. Elige la **fuente** que reciben esos leads y, si quieres, una **plantilla de bienvenida**: como el lead no te ha escrito, la ventana de 24 horas está cerrada y solo una plantilla aprobada puede abrir la conversación.
3. Cada lead crea (o actualiza) el contacto con las respuestas del formulario y una oportunidad en la primera etapa del embudo predeterminado.

Con cada lead se guardan el **formulario** y, si Meta los da con el permiso de tu página, el **anuncio** y la **campaña**. En **Ajustes › Canales › Formularios de Facebook** ves cada lead recibido y si se procesó bien.

### Cuando el lead escribe por WhatsApp

Muchos formularios terminan con un botón para escribir por WhatsApp. Meta no une el formulario con el chat: la unión es el **teléfono**. Driony lo hace solo:

- Si el formulario trae el número **sin prefijo de país**, se le pone el del número de WhatsApp de tu empresa.
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

Qué se envía lo decides **etapa por etapa**: pulsa el engranaje de la etapa (en la columna del tablero del embudo o en **Ajustes › Embudos y etapas**) y, en «Conversiones de Meta», añade eventos. Un embudo nuevo arranca con `LeadSubmitted` en la etapa Potencial y `Purchase` (con el valor y la moneda de la oportunidad) en la Ganada.

La lista ofrece los eventos que Meta admite para mensajería: LeadSubmitted, QualifiedLead, Purchase, InitiateCheckout, AddToCart, ViewContent, CartAbandoned, los de pedido (OrderCreated, OrderShipped, OrderDelivered, OrderCanceled, OrderReturned), RatingProvided y ReviewProvided. Puedes poner un nombre propio, pero Meta no garantiza aceptarlo.

Cuando una oportunidad cuyo chat vino de un anuncio llega a una etapa, se envían sus eventos, cada uno una sola vez por oportunidad, con el **último clic** del cliente que traiga `ctwa_clid`. El agente de IA mueve a Potencial y Ganada con `mark_lead`; el resto, con las automatizaciones o a mano. En la tarjeta de Integraciones ves los últimos eventos enviados y puedes reintentar los que fallaron. Los chats que no vinieron de un anuncio no envían nada. Requiere que la app de Meta tenga el permiso `whatsapp_business_manage_events`.

## Ventana gratuita de los anuncios

Cuando respondes en 24 horas a un chat que llegó de un anuncio click-to-WhatsApp, Meta abre una ventana de entrada gratuita: desde el 1 de octubre de 2026 dura hasta 7 días y en ella las plantillas no se cobran. Los mensajes libres (sin plantilla) siguen necesitando la ventana normal de 24 horas desde el último mensaje del cliente.
