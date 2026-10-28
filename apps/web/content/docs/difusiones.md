# Difusiones y plantillas

Una difusión es un envío masivo de una **plantilla aprobada por Meta** a un segmento de contactos. Es la única manera de escribir a quien no te ha escrito en las últimas 24 horas.

## Plantillas

En **Difusiones › Plantillas** ves las plantillas de tu cuenta de WhatsApp Business y su estado en Meta (aprobada, pendiente, rechazada). Puedes crear plantillas nuevas desde el CRM —texto con variables, encabezado con imagen o documento, botones— y enviarlas a revisión; Meta suele responder en minutos u horas.

Consejos para que las aprueben:

- Nada de mensajes genéricos tipo «Hola»: la plantilla debe tener un propósito claro.
- Las variables (`{{1}}`, `{{2}}`) necesitan un ejemplo.
- Marketing, utilidad y autenticación son categorías distintas y se cobran distinto; elige bien.

## Crear una difusión

1. **Difusiones → Nueva**: nombre, número desde el que sale y plantilla.
2. **Audiencia**: el recuento se actualiza mientras eliges. Siempre son solo contactos con consentimiento (los que escribieron BAJA/STOP quedan fuera).
   - **Etiquetas**: con *alguna* o con *todas* las que marques.
   - **No repetir** (activado por defecto, 7 días): deja fuera a quien recibió otra difusión hace poco. Demasiados mensajes de marketing bajan la calidad de tu número.
   - **Más filtros**: excluir etiquetas, contactos con una oportunidad abierta en ciertas etapas, fuente, país (por el prefijo del teléfono) y actividad (escribió en los últimos N días, o lleva más de N días sin escribir).
3. Rellena las variables de la plantilla (pueden tomar datos del contacto).
4. **Enviar una prueba** a tu propio número para ver cómo llega. El nombre del contacto sale como «Prueba».
5. **Enviar ahora** o **programar** fecha y hora.

**Desde el embudo**: el icono de megáfono en la cabecera de una etapa abre una difusión para los contactos de esa etapa. Con **Seleccionar**, elige oportunidades sueltas y pulsa **Difusión** en la barra de abajo. En los dos casos el asistente se abre ya rellenado; los contactos sin consentimiento quedan fuera igualmente.

## Resultados

Cada difusión muestra su estado (borrador, programada, enviando, enviada, cancelada) y, mientras se envía, una barra de avance. Abre **Ver resultados** para ver la ficha:

- **Embudo**: enviados → entregados → leídos → respondieron, y los fallidos. «Respondieron» cuenta a quien te escribió en los 7 días siguientes al envío.
- **Destinatarios**: cada contacto con su estado, el motivo si falló y un acceso directo a su chat. Puedes filtrar por respondieron, leídos, sin entregar o fallidos, y exportar la lista a CSV.
- **Etiquetar a quienes respondieron**: les pone una etiqueta para seguir con ellos (un flujo, una etapa o la próxima difusión).
- **Reintentar los fallidos**: vuelve a enviar solo a quien sigue con consentimiento. Revisa antes el motivo: un número sin WhatsApp volverá a fallar.
- **Duplicar**: crea un borrador con la misma plantilla, variables y audiencia.

Las métricas se calculan a partir del último estado de cada mensaje, así que no se inflan si WhatsApp avisa dos veces o fuera de orden.

## Lo que debes saber de WhatsApp

- **Consentimiento**: solo escribe a quien aceptó recibir mensajes. Los reportes de spam bajan la calidad de tu número y Meta puede limitarlo.
- **Límites de envío**: un número nuevo puede iniciar conversaciones con un número limitado de clientes al día; el límite sube automáticamente con el uso y la calidad.
- **Respuestas**: cuando un contacto responde a una difusión, se abre la ventana de 24 horas y la conversación aparece en la bandeja como cualquier otra, con el agente de IA si lo tienes activo.
