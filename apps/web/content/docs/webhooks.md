# Webhooks salientes

Con los webhooks el CRM **avisa a tu sistema** cuando pasa algo. **Ajustes › Webhooks salientes → Nuevo**: pon la URL de tu sistema y marca los eventos que te interesan.

| Evento | Cuándo se dispara |
|---|---|
| `message.received` | Entra un mensaje de un cliente |
| `message.sent` | El CRM envía un mensaje |
| `contact.created` | Se crea un contacto |
| `deal.created` | Se crea una oportunidad |
| `deal.stage_changed` | Una oportunidad cambia de etapa |
| `conversation.escalated` | La IA se rinde y pasa el chat a un humano |
| `booking.created` / `booking.rescheduled` / `booking.cancelled` | Se reserva, se mueve o se cancela una cita |
| `catalog.synced` | Se actualizó el catálogo desde una tienda conectada o por la API (trae la conexión y cuántos productos cambiaron) |

El CRM manda un `POST` con este cuerpo:

```json
{
  "event": "contact.created",
  "occurredAt": "2026-09-14T10:32:11.482Z",
  "data": { "contact": { "id": "cmu0…", "phone": "+51999888777" } }
}
```

y estas cabeceras:

```
X-CRM-Event:     contact.created
X-CRM-Signature: sha256=3f2a…
```

## Verifica la firma

Es lo que distingue un aviso real de cualquiera que descubra tu URL. Calcula el HMAC-SHA256 del **cuerpo exacto** con el secreto de la suscripción y compáralo en tiempo constante:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verificar(cuerpoCrudo, firmaRecibida, secreto) {
  const esperada =
    "sha256=" + createHmac("sha256", secreto).update(cuerpoCrudo).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(firmaRecibida);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Usa el cuerpo **sin parsear**: si lo conviertes a objeto y lo vuelves a serializar, cambia un espacio y la firma deja de cuadrar.

## Reintentos

Si tu endpoint no responde `2xx`, el CRM reintenta **5 veces con espera creciente** (1 min, 2, 4, 8, 16). El panel muestra el último código HTTP, el error y los contadores de entregas y fallos.

Un webhook que falle **nunca afecta a la operación del CRM**: el envío va en cola aparte y no bloquea nada.

## Conectar n8n

1. En n8n, nodo **Webhook**, método `POST`. Copia su URL de producción.
2. En el CRM, **Ajustes › Webhooks salientes → Nuevo**, pega esa URL y marca los eventos.
3. Pulsa **Probar**: te confirma al momento si n8n respondió.
4. Para verificar la firma en n8n, un nodo **Code** con la función de arriba.

Para el camino inverso —que n8n escriba en el CRM— usa la [API pública](/docs/api) o el bloque **Petición HTTP** de los [flujos](/docs/flujos).
