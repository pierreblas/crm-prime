# «Atiende» dice la verdad: el agente principal se elige

Diseño corto, aprobado por el dueño el 21-11-2026 («dale»).

## Por qué

En producción, Flyteek editaba a Lia y en WhatsApp seguía contestando otro
agente. El selector «Atiende» de cada agente ofrecía «Todos los números sin
agente propio», y la lista ponía «Todos los números» a cualquier agente sin
número. Pero el código (`BotService.resolveForChannel`) solo usa para esos
números el agente **principal** (`isDefault`). Un agente nuevo sin número no
contestaba a nadie en WhatsApp y la pantalla decía lo contrario. En «Probar
conversación» salía bien porque ahí se prueba el agente elegido.

## Qué cambia

El selector «Atiende» hace lo que dice:

| Opción | Qué pasa al guardar |
|---|---|
| Un número | Contesta en ese número (como hoy) |
| **Todos los números sin agente propio** | Pasa a ser el **principal**. El que lo era deja de serlo y se queda con su número, o con «Ningún número» si no tenía |
| **Ningún número** (nueva) | No contesta en WhatsApp: solo en los embudos, páginas o cuentas donde se elija, y en las pruebas |

- El principal no tiene «Ningún número»: para que deje de serlo, se elige «Todos los números» en otro agente. Si tiene un número propio, además sigue cubriendo los números sin agente (como hoy).
- Un agente nuevo empieza en «Ningún número».
- En la lista de agentes, cada uno dice lo que hace: su número, «Todos los números» (principal sin número) o «Sin número».
- Con «Ningún número», el editor avisa quién contesta en su lugar: «En WhatsApp no contesta a nadie: los números sin agente propio los atiende «X», el principal…».
- El copiloto del administrador dice lo mismo («sin número» en vez de «todos los números sin agente propio» para un agente que no es el principal).

## Cómo

- `createBotSchema` y `updateBotSchema` aceptan `isDefault: boolean` opcional. `true` hace principal al agente (transacción: se quita al anterior y se pone al nuevo, por el índice único parcial `orgId WHERE isDefault`). `false` sobre el principal se rechaza con un mensaje que explica cómo cambiarlo. `false` sobre otro agente no hace nada.
- La resolución de quién contesta no cambia. No hay migración.

## Enfoques que se descartaron

- **Que cualquier agente sin número conteste los números sin agente**: con dos así no se sabe cuál. La regla de un solo principal ya existe y es clara.
- **Un botón aparte «Hacer principal»**: son dos sitios para una misma decisión, y el selector seguiría mintiendo.

## Fuera de alcance

- El agente de Messenger, Instagram y TikTok (se elige en su página o cuenta, sin cambios).
- Avisar de los embudos donde está asignado el agente.
