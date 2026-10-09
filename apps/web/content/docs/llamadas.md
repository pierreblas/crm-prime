# Llamadas telefónicas

Driony registra las llamadas con tus contactos en el mismo hilo que sus mensajes de WhatsApp, y puede hacerlas y recibirlas **desde el navegador** con un número de Twilio.

## Sin Twilio: registrar llamadas

El botón **Llamar** (en el chat, en el panel del contacto y en la tarjeta del embudo) muestra el número con **Abrir en el teléfono** (marca desde tu celular o la app de llamadas del equipo) y te deja **registrar la llamada**: entrante o saliente, cómo fue (contestó, no contestó, buzón, ocupado, número equivocado, pide que le llamen), cuánto duró y una nota. Queda en el hilo de la conversación, con la hora y quién la hizo.

## Con Twilio: llamar y recibir desde el CRM

1. Crea una cuenta en [Twilio](https://www.twilio.com), compra un **número de voz** del país donde vendes y, en *Account › API keys & tokens*, crea una **API Key** (anota el SID y el secreto: el secreto solo se muestra una vez).
2. En **Ajustes › Integraciones › Llamadas (Twilio)** pega el **Account SID**, el **Auth Token**, la **API Key** y su **secreto**, y el **número** en formato internacional (`+51…`). Marca si quieres **grabar** las llamadas.
3. Guarda y pulsa **Activar llamadas**: Driony crea en tu cuenta de Twilio la aplicación de voz y deja el número apuntando a sus webhooks. No tienes que tocar nada en Twilio.

Desde ese momento:

- **Llamar** desde el chat, el contacto o el embudo marca desde el navegador (te pedirá permiso para el micrófono la primera vez).
- Cuando llaman al número de la empresa, **suena en el navegador de todo el equipo** (hasta 10 personas); contesta quien primero pulse. Si nadie contesta en 25 segundos, el cliente oye un aviso y la llamada queda como **perdida**.
- Al colgar se pide el **resultado** y una nota; la llamada aparece en el hilo con su duración.
- Si activaste la grabación, la **grabación** se guarda en Driony y, si tienes clave de OpenAI en Ajustes › IA, se **transcribe** sola: la transcripción se lee desde el hilo y la IA la tiene en cuenta como contexto.
- Un número que llama y no existe como contacto se crea con origen **Llamada**.

### Llamadas perdidas y flujos

El disparador **«Llamada perdida»** de los [flujos](/docs/flujos) arranca cuando nadie contesta una llamada entrante: por ejemplo, para enviar una plantilla de WhatsApp («Vimos tu llamada, ¿en qué te ayudamos?») o poner una etiqueta.

### Requisitos del servidor

Twilio tiene que poder llegar a Driony: el servidor necesita saber su dirección pública (`API_PUBLIC_URL`, o `SAAS_BASE_DOMAIN` en la nube). En un equipo local sin dirección pública, las llamadas desde el navegador no funcionan; el registro manual sí.

### Costes

Twilio cobra el número (unos pocos dólares al mes) y los minutos, según el país y si es fijo o móvil. Las llamadas entre el navegador y Twilio se cobran como llamadas de cliente. Consulta las tarifas de tu país en Twilio.
