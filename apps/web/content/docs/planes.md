# Planes y límites

Los precios y lo que incluye cada plan están en la [página de precios](/precios). Aquí, cómo se aplican los límites.

En la nube de Driony (`tu-empresa.driony.com`) cada empresa tiene un plan. El plan dice cuántos números de WhatsApp y cuántos usuarios puedes tener, cuántos tokens de IA tienes al mes y qué características incluye. Se paga por empresa, no por usuario. En la [versión de código abierto](/docs/autoalojado) no hay planes: todo es ilimitado.

| | Gratis | Inicial | Pro | Empresa |
|---|---|---|---|---|
| Precio | 0 | USD 19/mes | USD 49/mes | USD 149/mes |
| Números de WhatsApp | 1 | 1 | 3 | Sin límite |
| Usuarios del equipo | 2 | 3 | 10 | Sin límite |
| Contactos | 500 | 2.000 | 5.000 | Sin límite |
| Oportunidades abiertas | 200 | 1.000 | 2.000 | Sin límite |
| Contactos activos al mes (orientativo) | 300 | 1.000 | 3.000 | 15.000 |
| Tokens de IA incluidos al mes | 2,5 M | 12 M | 50 M | 150 M |
| Adjuntos guardados | 90 días | 6 meses | 1 año | 3 años |
| Bandeja, agentes de IA, embudos, flujos y agenda | Sí | Sí | Sí | Sí |
| Coexistencia con el celular | No | Sí | Sí | Sí |
| Difusiones con plantillas | No | No | Sí | Sí |
| API pública y webhooks | No | No | Sí | Sí |
| Soporte prioritario | No | No | No | Sí |

## Prueba de 15 días

Al crear tu empresa en la nube tienes **15 días del plan Pro completo**, sin tarjeta: más números y usuarios, difusiones, API, coexistencia y **12 M de tokens de IA** para probar el agente. En **Ajustes › Plan** y en el menú lateral ves los días que quedan.

Al terminar la prueba tu empresa sigue en el plan **Gratis**, sin cortar ni borrar nada: como en cualquier bajada de plan, lo que ya tienes se queda (números, usuarios, contactos, un número en coexistencia) y lo que se frena es añadir más. Para quedarte en Pro o pasar a otro plan, escríbenos desde **Ajustes › Plan** antes o después de que termine.

## IA incluida y tokens extra

Sin configurar nada, el agente usa la **IA de Driony** con el cupo de tu plan. Se mide en **tokens**, los mismos que Driony paga al proveedor: sin créditos inventados ni cobro por conversación. Todo lo que hace la IA sale del mismo cupo: el agente y sus seguimientos, el copiloto, los asistentes de redacción y de flujos, las preguntas sin respuesta, y los audios e imágenes de los clientes (un minuto de audio son unos 25.000 tokens). Entrada y salida cuentan por igual. De media, una conversación atendida por el agente gasta unos 20.000 tokens. El cupo vuelve a empezar el día 1 de cada mes.

Lo llevado del mes se ve **arriba a la derecha, junto a tu foto**: «IA 1,2 M/2,5 M». Se pone ámbar al 80 %, más al 95 % y rojo al gastarlo; al pulsarlo ves cuándo se renueva y, si eres administrador, cómo ampliarlo. Al 80 %, al 95 % y al tope, los administradores ven también un aviso debajo de la cabecera.

Al gastar el cupo, el agente **termina las conversaciones que ya atendía** ese mes (hasta un 5 % por encima del cupo) y las nuevas pasan a tu equipo hasta el día 1; el copiloto y los asistentes se detienen. Nadie se queda a medias. Para que la IA siga tienes tres caminos:

- **Tokens extra.** Paquetes de **20 M por USD 12** o **60 M por USD 29**, que se pagan una vez. Valen **6 meses** y se gastan solo cuando se acaba el cupo de tu plan, el que vence antes primero. Los pides en **Ajustes › Plan › Tokens extra** y los ves allí con lo que te queda y cuándo vencen.
- **Tu propia clave.** Conecta tu clave de OpenAI, Anthropic o cualquier API compatible en **Ajustes › Inteligencia Artificial**: no hay cupo, eliges el modelo de cada agente y pagas a tu proveedor a su precio, sin margen nuestro.
- **Un plan mayor**, con más tokens incluidos.

Además del cupo hay un **tope de seguridad en dólares** que protege de bucles o abusos (por ejemplo, mucha salida, que cuesta más que la entrada); en un uso normal no se alcanza. Si se alcanzara, la IA de Driony se pausa hasta el mes siguiente y los chats pasan a tu equipo. Los tokens extra suben ese tope.

### Qué credencial usa cada función

Una sola modalidad por empresa: **IA incluida** (sin clave propia) o **tu propia clave**. Guardar una clave en **Ajustes › Inteligencia Artificial** pasa a tu clave; borrarla vuelve a la incluida. Cada cambio queda en el historial de esa pantalla, con quién lo hizo. Se puede en todos los planes, Gratis incluido.

| Función | Con la IA incluida | Con tu propia clave |
|---|---|---|
| Agente automático y seguimientos que redacta la IA | Clave de Driony con su modelo fijo; sus tokens salen del cupo | Tu clave y el modelo que elijas en cada agente; sin cupo |
| Copiloto del chat, asistentes de redacción y de flujos, preguntas sin respuesta, memoria del cliente | Clave de Driony; sus tokens salen del cupo | Tu clave |
| Indexar y buscar en el conocimiento, transcribir audios, describir imágenes | Clave de OpenAI de Driony; sus tokens salen del cupo (indexar sigue aunque esté gastado) | Tu clave de **OpenAI**. Si solo tienes clave de Anthropic, estas tres funciones siguen usando la de Driony y gastan tu cupo: es la única mezcla entre las dos modalidades |

En **Consumo de IA** lo que corrió con la clave de Driony aparece separado de lo que corrió con la tuya, siempre estimado a precio de lista.

### Lo que ya estaba en cola

Un mensaje que el agente tenía pendiente de responder, un seguimiento programado o una indexación en marcha usan la modalidad **vigente al ejecutarse**, no la de cuando se encolaron, y registran la que usaron. Si borras tu clave con trabajos en cola, esos trabajos corren con la IA incluida y cuentan en su cupo; si conectas una, corren con la tuya.

Si tu empresa usa su propia clave y esa clave deja de funcionar (el proveedor la rechaza, se quedó sin cuota o Driony no puede leerla), **no** se vuelve solo a la IA incluida: el agente para con el motivo «Falta la clave de IA» hasta que la arregles o la borres a propósito desde Ajustes.

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

En **Ajustes › Plan** ves tu plan, cuánto llevas usado, tus tokens extra y qué incluye cada plan.

Todavía no hay cobro automático: para cambiar de plan o pedir tokens extra, escríbenos desde **Ajustes › Plan**. Lo activamos el mismo día y te lo confirmamos antes de cobrarte nada.
