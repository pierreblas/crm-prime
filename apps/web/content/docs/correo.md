# Correo

Desde Driony puedes **escribir por correo** a tus contactos: a mano, con plantillas, o de forma automática desde un flujo. El correo sale de **tu propio buzón**, con tu dirección de siempre, y las respuestas llegan a ese buzón (no a Driony).

## Conectar tu buzón

En **Ajustes › Correo › Conectar buzón** eliges tu proveedor y completas los datos de salida (SMTP):

- **Gmail o Google Workspace.** Google pide tener la **verificación en dos pasos** activada y crear una **contraseña de aplicación**: tu contraseña normal no sirve. El formulario trae el enlace para crearla.
- **Microsoft 365.** Solo funciona si el administrador de Microsoft 365 tiene activado el *SMTP autenticado* para ese buzón.
- **Otro proveedor.** Los datos de salida que te da tu hosting o tu servicio de correo: servidor, puerto, usuario y contraseña.

Al guardar, Driony **comprueba que el servidor acepta el acceso**. Si la contraseña está mal, lo dice en ese momento. Con **Probar** se envía un correo al propio buzón, para verlo llegar.

Cada buzón tiene:

- **Quién lo usa.** *Compartido* lo usa todo el equipo y es por el que salen los correos de los flujos. *Personal* solo lo usa su dueño.
- **Nombre que verá quien recibe** y **firma**, que va al final de cada correo de ese buzón.
- **Tope de correos al día** (300 por defecto). Los proveedores bloquean a quien envía demasiado: el tope protege tu dirección.

La contraseña se guarda cifrada y no vuelve a mostrarse. La conexión va siempre cifrada, por los puertos 465, 587 o 2525.

## El correo de cada contacto

En la ficha del contacto (en la **Bandeja** y en **Contactos**) hay un bloque **Correo** con su dirección, que se edita ahí mismo. También llega sola desde los formularios de Meta, la API y los webhooks de leads (campo `email`), y un flujo puede pedirla con **Preguntar y guardar** validando que sea un correo. Los contactos se pueden buscar por su correo.

## Escribir a un contacto

En ese mismo bloque, **Escribir** abre la ventana del correo:

1. Eliges desde qué buzón sale y, si quieres, una **plantilla**: el asunto y el mensaje quedan rellenados con los datos del contacto para que los retoques.
2. Puedes **adjuntar** hasta 5 archivos (15 MB en total).
3. **Enviar correo.** Si el servidor lo rechaza, lo sabes al momento, con el motivo.

Si el contacto no tenía correo, escribes la dirección y queda guardada en su ficha. Cada correo enviado aparece en el **historial** de ese bloque y como **nota en su chat**.

## Plantillas de correo

Se crean en **Difusiones › Plantillas de correo** (las crea quien administra; las usa todo el equipo). Llevan nombre, asunto, mensaje y adjuntos opcionales. No pasan por Meta ni esperan aprobación.

En el asunto y el mensaje puedes usar **variables**:

| Variable | Qué pone |
| --- | --- |
| `{{nombre}}` | Nombre completo del contacto |
| `{{primer_nombre}}` | Su primer nombre |
| `{{telefono}}` | Su teléfono |
| `{{correo}}` | Su correo |
| `{{empresa}}` | El nombre de tu empresa |
| `{{agente}}` | Quien envía |
| `{{clave_del_campo}}` | Cualquier campo personalizado del contacto, por su clave |

Si un contacto no tiene ese dato, el hueco queda en blanco. La vista previa lo enseña con datos de ejemplo y, al escribir, la ventana avisa de qué quedó vacío.

## Correos automáticos en los flujos

El bloque **Enviar correo** del constructor de flujos envía una plantilla al correo del contacto. Sirve en cualquier flujo, también en los de una **etapa del embudo**, y **no depende de la ventana de 24 h de WhatsApp**.

- **Sale por**: el buzón de la empresa, el del responsable del chat (su buzón personal y, si no tiene, el de la empresa) o uno concreto.
- La plantilla puede usar las **variables del flujo** por su nombre, por ejemplo `{{pedido}}`.
- Si el contacto no tiene correo, se dio de baja, no hay buzón o se llegó al tope del día, el flujo **sigue** y queda una nota en el chat con el motivo.
- Si el servidor de correo falla un momento, el envío se reintenta solo.

## Bajas

Los correos **automáticos** llevan un enlace de baja. Quien lo usa deja de recibirlos y aparece en **Ajustes › Correo › Bajas**, de donde se le puede quitar si lo pide. Escribirle **a mano** sigue siendo posible.

## Lo que todavía no hace

- **Recibir**: las respuestas llegan a tu buzón, no a la bandeja de Driony.
- **Envíos masivos** y medición de aperturas.
- Conexión con Google o Microsoft **sin contraseña** (con su botón de acceso).
