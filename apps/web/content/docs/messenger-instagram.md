# Conectar Messenger e Instagram

Los mensajes que llegan a tu página de Facebook (Messenger) y los mensajes directos de tu cuenta profesional de Instagram entran en la misma bandeja que WhatsApp. El agente de IA, los flujos, el embudo, las citas y los avisos funcionan igual: para tu equipo es un chat más, con la marca de su canal.

## Lo que necesitas

- Una **página de Facebook** que administres. Messenger va con la página.
- Para Instagram, una cuenta **profesional** (empresa o creador) **vinculada a esa página**, y con «Permitir el acceso a los mensajes» activado en la app de Instagram: Configuración › Mensajes y respuestas a historias › Controles de mensajes › Herramientas conectadas.
- Permiso de Meta. Driony pide `pages_messaging` (Messenger) e `instagram_basic` + `instagram_manage_messages` (Instagram) al conectar. Mientras Meta no los apruebe en la revisión de la app, solo pueden concederlos las personas con un rol en la app: sirve para probar con tu propia empresa.

## Conectar

1. **Ajustes › Canales › Messenger** (o **Instagram**) → **Conectar con Facebook**. Entra con la cuenta que administra la página y acepta los permisos.
2. Elige las páginas. Cada una queda conectada y con el canal **encendido**.
3. En cada página eliges el **agente de IA** que la atiende, el **embudo** al que entran sus conversaciones y la **fuente** con la que entran sus contactos. Sin elegir, son los predeterminados de la empresa y las fuentes automáticas «Messenger» e «Instagram» (puedes renombrarlas en Ajustes › Fuentes).

Si ya tenías la página conectada para los formularios, no hace falta volver a entrar: enciende el interruptor del canal en su fila. Si Meta pide permisos que no diste la primera vez, pulsa «Añadir páginas» y acéptalos.

Un canal apagado no recibe nada; al encenderlo entra lo que llegue desde ese momento, no lo anterior.

## En la bandeja

- La fila de la conversación lleva la marca de **Messenger** o **Instagram** y el nombre de la página (o el @ de Instagram). El filtro por canal los separa.
- El contacto se identifica por su cuenta: en Messenger, con su nombre si Meta lo comparte; en Instagram, con su **@usuario**. No tiene teléfono hasta que te lo dé, así que no se le puede llamar ni incluir en una difusión de WhatsApp. Si después escribe por WhatsApp, será otro contacto salvo que los unas.
- Fotos, videos, audios y archivos entran como en WhatsApp. Lo que no es un archivo (una publicación o un reel compartido, una mención en una historia, una respuesta a tu historia) aparece explicado en el mensaje, con el enlace.
- Los **botones** que envías (los de un flujo o del agente) se ven como respuestas rápidas; las listas también; los carruseles, como tarjetas. Lo que pulsa el cliente llega igual que en WhatsApp.
- Lo que tu equipo responda desde la bandeja de Meta o la app de Instagram también aparece, como enviado por una persona, y pausa la IA unos minutos.

## La ventana de 24 horas

Igual que WhatsApp, Meta deja escribir libremente hasta **24 horas** después del último mensaje del cliente. La diferencia está en lo que pasa después:

- No hay plantillas ni difusiones en Messenger ni en Instagram.
- Una **persona** puede seguir respondiendo hasta **7 días** después del último mensaje del cliente (Meta lo llama «agente humano»; la app tiene que tener ese permiso aprobado). El compositor te lo indica. Pasados los 7 días, hay que esperar a que el cliente vuelva a escribir.
- El agente de IA y los seguimientos automáticos respetan las 24 horas; los toques de plantilla se saltan en estos canales.

## Si usas tu propia app de Meta

Las empresas que conectan con la app de la plataforma no tienen que configurar nada en Meta. Si usas tu propia app, en **Webhooks** apunta a la misma URL que los formularios (`…/api/v1/meta/webhook`, con el token de verificación de WhatsApp) y suscribe:

- el objeto **Página** a `messages`, `messaging_postbacks`, `message_echoes`, `message_reads`, `message_deliveries`, `message_reactions` y `messaging_referrals` (además de `leadgen`);
- el objeto **Instagram** a `messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions` y `messaging_referral`.

## Problemas frecuentes

- **«Esta página no tiene una cuenta profesional de Instagram vinculada»**: vincúlala desde la configuración de la página (Instagram › Cuenta vinculada) y vuelve a conectar con Facebook aceptando todos los permisos.
- **No llegan mensajes**: comprueba que el canal está encendido en la fila de la página y, en Instagram, que «Permitir el acceso a los mensajes» está activado. Si la app es tuya, revisa la suscripción de webhooks.
- **«El acceso a la página caducó»**: alguien cambió la contraseña o quitó permisos. Pulsa «Añadir páginas», deja marcada la página y acepta.
- **Meta rechaza una respuesta fuera de las 24 h**: la app no tiene aprobado el permiso de agente humano. Dentro de las 24 horas funciona igualmente.
