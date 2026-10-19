# Anuncios y leads de Meta

Driony recoge los contactos que llegan desde Facebook e Instagram por dos caminos, y guarda de dónde vino cada uno.

## Anuncios click-to-WhatsApp

Son los anuncios cuyo botón abre una conversación de WhatsApp. No hay que configurar nada: cuando el primer mensaje llega desde un anuncio, Driony lo detecta y guarda en el contacto:

- **Procedencia**: *anuncio*, con el titular y el identificador del anuncio;
- la **fuente** «Anuncio de Meta»;
- los parámetros **utm_*** que pongas en la URL del anuncio o en el texto prellenado del enlace `wa.me`;
- el **ctwa_clid**, el identificador del clic que Meta usa para atribuir conversiones.

Todo eso se ve en la ficha del contacto y sale por la [API pública](/docs/api) (`origin`, `utm`).

## Lead Ads (formularios)

Los formularios de clientes potenciales de Facebook e Instagram entran al CRM en el momento en que alguien los envía:

1. **Ajustes › Canales › Formularios de Facebook → Conectar con Facebook**: autoriza con la cuenta que administra la página.
2. Elige la **fuente** que reciben esos leads y, si quieres, una **plantilla de bienvenida**: como el lead no te ha escrito, la ventana de 24 horas está cerrada y solo una plantilla aprobada puede abrir la conversación.
3. Cada lead crea (o actualiza) el contacto con las respuestas del formulario y una oportunidad en la primera etapa del embudo predeterminado.

En **Ajustes › Canales › Formularios de Facebook** ves cada lead recibido, su formulario y si se procesó bien.

## Atribución en tus métricas

En la ficha del contacto distinguimos dos cosas:

- **Fuente**: comercial, la que tú defines y usas para repartir vendedores (Ajustes › Fuentes).
- **Procedencia**: técnica, por qué vía entró (anuncio, WhatsApp, webhook, importación) y con qué detalle (número, nombre de la clave de API, anuncio).

Con la API `stats/*` puedes cruzar fuente, embudo y vendedor en tu propio panel.

## Conversiones de vuelta a Meta

Driony guarda los identificadores que Meta necesita para atribuir resultados a los anuncios: el `ctwa_clid` de cada conversación que vino de un anuncio y el `lead_id` de cada lead de formulario. Con ellos Driony envía a Meta las etapas del embudo mediante la Conversions API, para que las campañas optimicen hacia clientes de verdad y no solo hacia clics.

## Conversiones de anuncios

En **Ajustes › Integraciones › Conversiones de anuncios (Meta)** activa cada número de WhatsApp. Al activarlo, Driony obtiene (o crea) el *dataset* de su cuenta de WhatsApp Business.

Qué se envía lo decides **etapa por etapa**: pulsa el engranaje de la etapa (en la columna del tablero del embudo o en **Ajustes › Embudos y etapas**) y, en «Conversiones de Meta», añade eventos. Cada etapa tiene su lista, y puede haber varios. Un embudo nuevo arranca con `LeadSubmitted` en la etapa Potencial y `Purchase` (con el valor y la moneda de la oportunidad) en la Ganada. Puedes añadir los eventos estándar de Meta (Contact, Schedule, SubmitApplication, CompleteRegistration, StartTrial, Subscribe, InitiateCheckout…) o uno con nombre propio, y marcar en cada uno si va con el valor de la oportunidad.

Cuando una oportunidad cuyo chat nació de un anuncio Click to WhatsApp llega a una etapa, se envían sus eventos, cada uno una sola vez por oportunidad. El agente de IA mueve a Potencial y Ganada con `mark_lead`; el resto, con las automatizaciones o a mano. En la tarjeta de Integraciones ves los últimos eventos enviados y puedes reintentar los que fallaron. Los chats que no vinieron de un anuncio no envían nada. Requiere que la app de Meta tenga el permiso `whatsapp_business_manage_events`.
