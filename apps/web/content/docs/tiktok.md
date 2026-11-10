# Conectar TikTok

Los mensajes directos de tu cuenta de empresa de TikTok entran en la misma bandeja que WhatsApp, Messenger e Instagram. El agente de IA, los flujos, el embudo, las citas y los avisos funcionan igual: para tu equipo es un chat más, con la marca de TikTok.

## Lo que necesitas

- Una cuenta de TikTok **de empresa** (no personal; se cambia en la app, en Configuración y privacidad › Cuenta).
- **Acceso avanzado** en TikTok: la cuenta vinculada a TikTok for Business o a un Business Center, o verificada como empresa. Sin eso TikTok rechaza la conexión («Only Business account can use Message API»).
- Aceptar mensajes de **todos** (Privacidad › Mensajes directos). Si no, cada chat nuevo hay que aceptarlo a mano en la app antes de que llegue a Driony.
- Cuenta registrada en Latinoamérica, Asia-Pacífico, Oriente Medio o Norteamérica. TikTok no abre su API a las cuentas de la Unión Europea, Suiza ni el Reino Unido; las de Estados Unidos exigen una revisión adicional a Driony.

## Conectar

1. **Ajustes › Canales › TikTok** → **Conectar con TikTok**. Entras en TikTok con la cuenta de empresa y aceptas los permisos.
2. TikTok te devuelve a Driony. La cuenta aparece en la lista, **encendida**.
3. En su fila eliges el **agente de IA**, la **fuente** con la que entran sus contactos y el **embudo**. Sin elegir, son los predeterminados y la fuente automática «TikTok» (puedes renombrarla en Ajustes › Fuentes).

El permiso que TikTok concede a Driony dura 30 días sin que la cuenta vuelva a entrar. Si caduca, la fila lo avisa: pulsa **Volver a autorizar**. Las conversaciones ya recibidas se conservan.

## En la bandeja

- La fila lleva la marca de **TikTok** y el @ de la cuenta. El filtro por canal los separa.
- El contacto se identifica por su **@usuario** de TikTok. No tiene teléfono hasta que te lo dé: no se le puede llamar ni incluir en una difusión. Si después escribe por WhatsApp será otro contacto salvo que los unas.
- Entran texto e imágenes. Un sticker o un video compartido aparecen explicados en el mensaje (con el enlace cuando lo hay).
- Lo que respondas desde la app de TikTok también aparece, como enviado por una persona, y pausa la IA unos minutos.

## Lo que TikTok permite

- **El cliente escribe primero.** No hay forma de iniciar una conversación ni plantillas ni difusiones.
- Puedes responder hasta **48 horas** después de su último mensaje, con un tope de **10 mensajes** por cada vez que te escribe. Pasado el plazo hay que esperar a que vuelva a escribir; el compositor lo indica.
- Solo **texto e imágenes** JPG o PNG de hasta 3 MB. Un pie de foto va en un mensaje aparte.
- **Sin botones.** Las opciones de un flujo o del agente van numeradas en el texto («1) …, 2) …») y el cliente responde escribiendo.
- Los **enlaces no se pueden pulsar** dentro de TikTok. El agente lo sabe: pone los datos en el propio mensaje y, si hace falta, pide el WhatsApp del cliente.
- No hay reacciones ni «escribiendo…».

## Para quien administra la app de TikTok

Las empresas de la nube no configuran nada en TikTok: usan la app de Driony. En una instalación propia hace falta una app de TikTok for Business con el producto **Business Messaging API** aprobado (TikTok revisa la seguridad de datos del desarrollador antes de dar acceso), con la URL de retorno `…/api/v1/tiktok/callback` registrada; el webhook `…/api/v1/tiktok/webhook` lo registra el API al arrancar. Variables: `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, y `WEB_PUBLIC_URL` si no hay dominio de SaaS.

## Problemas frecuentes

- **«Esta cuenta de TikTok no tiene acceso avanzado»**: vincúlala a TikTok for Business o Business Center en la app de TikTok y vuelve a conectar.
- **No llegan mensajes**: comprueba que la cuenta está encendida en su fila, que acepta mensajes de todos y que no está en una región sin API. Los chats que la cuenta aún no aceptó en la app tampoco llegan.
- **«La autorización de TikTok caducó»**: pulsa «Volver a autorizar» en la fila de la cuenta.
- **TikTok rechaza una imagen**: tiene que ser JPG o PNG de menos de 3 MB, y la conversación tiene que admitir imágenes (TikTok lo restringe en algunas regiones y por riesgo).
