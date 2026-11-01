# Planes y límites

Los precios y lo que incluye cada plan están en la [página de precios](/precios). Aquí, cómo se aplican los límites.

En la nube de Driony (`tu-empresa.driony.com`) cada empresa tiene un plan. El plan dice cuántos números de WhatsApp y cuántos usuarios puedes tener, cuántas conversaciones atiende la IA al mes y qué características incluye. Se paga por empresa, no por usuario. En la [versión de código abierto](/docs/autoalojado) no hay planes: todo es ilimitado.

| | Gratis | Inicial | Pro | Empresa |
|---|---|---|---|---|
| Precio | 0 | USD 19/mes | USD 49/mes | USD 149/mes |
| Números de WhatsApp | 1 | 1 | 3 | Sin límite |
| Usuarios del equipo | 2 | 3 | 10 | Sin límite |
| Contactos | 500 | 2.000 | 5.000 | Sin límite |
| Oportunidades abiertas | 200 | 1.000 | 2.000 | Sin límite |
| Contactos activos al mes (orientativo) | 300 | 1.000 | 3.000 | 15.000 |
| Conversaciones con IA incluida al mes | 100 | 500 | 2.000 | 6.000 |
| Adjuntos guardados | 90 días | 6 meses | 1 año | 3 años |
| Bandeja, agentes de IA, embudos, flujos y agenda | Sí | Sí | Sí | Sí |
| Coexistencia con el celular | No | Sí | Sí | Sí |
| Difusiones con plantillas | No | No | Sí | Sí |
| API pública y webhooks | No | No | Sí | Sí |
| Soporte prioritario | No | No | No | Sí |

## Prueba de 15 días

Al crear tu empresa en la nube tienes **15 días del plan Pro completo**, sin tarjeta: más números y usuarios, difusiones, API, coexistencia y **500 conversaciones con IA** para probar el agente. En **Ajustes › Plan** y en el menú lateral ves los días que quedan.

Al terminar la prueba tu empresa sigue en el plan **Gratis**, sin cortar ni borrar nada: como en cualquier bajada de plan, lo que ya tienes se queda (números, usuarios, contactos, un número en coexistencia) y lo que se frena es añadir más. Para quedarte en Pro o pasar a otro plan, escríbenos desde **Ajustes › Plan** antes o después de que termine.

## IA incluida y conversaciones extra

Sin configurar nada, el agente usa la **IA de Driony** con el cupo de tu plan. Cuenta **conversaciones atendidas**, no mensajes ni tokens: un cliente que el agente atiende en el mes es una conversación, le responda una vez o veinte. El cupo vuelve a empezar el día 1 de cada mes.

Lo llevado del mes se ve **arriba a la derecha, junto a tu foto**: «IA 1.240/2.000». Se pone ámbar al 80 % y rojo al llegar al tope; al pulsarlo ves cuándo se renueva y, si eres administrador, cómo ampliarlo. Al 80 % y al tope, los administradores ven también un aviso debajo de la cabecera.

Al llegar al tope, el agente **termina las conversaciones que ya atendía** ese mes y las nuevas pasan a tu equipo hasta el día 1. Nadie se queda a medias. Para que el agente siga atendiendo lo nuevo tienes tres caminos:

- **Conversaciones extra.** Paquetes de **1.000 por USD 12** o **3.000 por USD 29**, que se pagan una vez. Valen **6 meses** y se gastan solo cuando se acaba el cupo de tu plan, el que vence antes primero; cada conversación gasta una sola vez al mes, como en el cupo. Las pides en **Ajustes › Plan › Conversaciones extra** y las ves allí con lo que te queda y cuándo vencen.
- **Tu propia clave.** Conecta tu clave de OpenAI, Anthropic o cualquier API compatible en **Ajustes › Inteligencia Artificial**: no hay cupo, eliges el modelo de cada agente y pagas a tu proveedor a su precio, sin margen nuestro.
- **Un plan mayor**, con más conversaciones incluidas.

Además del cupo hay un **tope de seguridad en dólares** que protege de bucles o abusos; en un uso normal no se alcanza. Si se alcanzara, la IA de Driony se pausa hasta el mes siguiente y los chats pasan a tu equipo. Las conversaciones extra suben ese tope.

## Cómo se aplican los límites

Los límites cuentan **al añadir**: al conectar otro número, crear otro usuario, o crear a mano un contacto o una oportunidad. Lo que ya tienes no se toca nunca, tampoco si bajas de plan. Si intentas pasarte, la pantalla te dice qué plan lo permite.

Contactos y oportunidades son **límites blandos**: quien te escribe por WhatsApp entra siempre y su oportunidad se crea igual, aunque estés al tope. Lo que se frena al llegar es crear o importar a mano y la API pública. Las oportunidades cuentan solo las **abiertas**: ganar, perder o descartar libera sitio.

Las características (Coexistencia, Difusiones, API) se comprueban al usarlas. En las pantallas donde no están incluidas verás un aviso con el plan que las incluye.

## Uso razonable y retención de adjuntos

No cobramos por mensaje ni por gigas. Cada plan está pensado para un número de **contactos activos al mes**: quien envía o recibe un mensaje durante el mes, sin contar las difusiones. Es orientativo: los picos son normales y nada se corta. Si lo superas de forma sostenida, te propondremos el plan que te corresponde. Lo ves en **Ajustes › Plan**.

Los **adjuntos** (fotos, audios, vídeos y documentos) se guardan el tiempo que marca el plan; pasado el plazo se borran de los servidores y el mensaje conserva su texto con la nota «Adjunto eliminado por la retención del plan». Si necesitas un archivo más tiempo, descárgalo. En la [versión de código abierto](/docs/autoalojado) no se borra nada: el disco es tuyo.

## Coexistencia y planes

Con el plan **Gratis**, el botón «Conectar WhatsApp» conecta el número en **modo API**: se atiende solo desde Driony. A partir del plan **Inicial**, el mismo botón activa la [Coexistencia](/docs/whatsapp): sigues usando el número en la app de WhatsApp Business del celular y Driony lo atiende a la vez.

Un número ya conectado en coexistencia sigue así aunque cambies de plan.

## Ver y cambiar tu plan

En **Ajustes › Plan** ves tu plan, cuánto llevas usado, tus conversaciones extra y qué incluye cada plan.

Todavía no hay cobro automático: para cambiar de plan o pedir conversaciones extra, escríbenos desde **Ajustes › Plan**. Lo activamos el mismo día y te lo confirmamos antes de cobrarte nada.
