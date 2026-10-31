# Product

## Register

product

> El CRM (app) es la superficie primaria y el registro por defecto. Habrá una
> **landing de marketing** pública; cuando se trabaje esa superficie se usa el
> registro `brand` (la marca ES el producto), no este default.

## Users

Equipos de venta que atienden a sus clientes por **WhatsApp**:

- **Vendedores (rol AGENT):** todo el día dentro de la bandeja respondiendo
  conversaciones, moviendo oportunidades en el pipeline y registrando datos del
  lead. Trabajan rápido, con muchas conversaciones a la vez, a menudo desde el
  móvil además del escritorio. Solo ven lo suyo (filtrado por fuente).
- **Administradores / dueños del negocio:** configuran la operación —conectan
  números de WhatsApp, crean bots y flujos de automatización, lanzan campañas,
  definen fuentes/etapas/productos y asignan vendedores. Necesitan visión global.

Contexto de uso: alta frecuencia, sesiones largas, mucha información en pantalla
(hilos, tarjetas de deal, métricas). La tarea principal cambia por sección pero
siempre prima **responder/avanzar rápido sin perder un lead**.

## Product Purpose

CRM para WhatsApp **preparado para agentes IA**. Centraliza conversaciones
multi-número en una bandeja en tiempo real, automatiza la atención con bots
(copilot/autopilot) y flujos visuales, y conecta esa conversación con el negocio:
pipeline de ventas, contactos con campos personalizados, catálogo de productos y
campañas/broadcasts. Incluye coexistencia (seguir usando la app de WhatsApp en el
celular y a la vez gestionar desde el CRM) y webhooks para recibir leads externos.

Éxito = el vendedor responde en segundos, ningún lead se enfría, y la IA resuelve
lo repetitivo para que el humano cierre las ventas.

## Brand Personality

**Moderno, enérgico, vivo.** Voz directa y cercana, sin jerga corporativa; habla
"de tú a tú" como una herramienta hecha por gente que también vende. El producto
se siente **actual y con ritmo** (no estático ni acartonado) y, sobre todo,
transmite **control**: el usuario siente que su operación está ordenada y bajo
mando. La energía se expresa con movimiento intencional y un acento vivo —el
**lima sobre carbón** es el ancla de identidad; el **verde WhatsApp** queda para
señalar lo que es WhatsApp y lo que salió bien—, no con saturación.

## Anti-references

- **SaaS genérico de plantilla:** tarjetas idénticas en rejilla, todo gris,
  dashboards clonados con "big number + label". Si grita "lo generó una IA", falló.
- **Demasiado colorido/infantil:** exceso de colores y emojis por todos lados,
  sensación de juguete. La energía va por movimiento y un acento, no por ruido.
- **Corporativo frío/anticuado:** azules corporativos rígidos, tablas densas
  estilo software de los 2000, sensación pesada y burocrática.

## Design Principles

1. **Velocidad sobre decoración.** Cada pantalla optimiza su tarea principal
   (responder, mover el deal, lanzar la campaña). El adorno que no acelera, sobra.
2. **Energía con propósito.** Moderno y vivo, pero el color y el movimiento
   sirven a la función (estado, foco, feedback), nunca decoran por decorar.
3. **Densidad legible.** Mucha información (hilos, tarjetas, métricas) con
   jerarquía clara y aire suficiente: densa pero nunca apretada ni ruidosa.
4. **Que no parezca plantilla.** Huir del SaaS genérico; identidad propia anclada
   en el lima de marca y en patrones pensados, no clonados.
5. **Confianza operativa.** Estados siempre claros (entregado/leído, ganado/
   perdido, IA pausada) y feedback inmediato a cada acción: el usuario nunca duda
   de qué pasó.

## Accessibility & Inclusion

Objetivo **WCAG 2.1 AA**:

- Contraste de texto ≥ 4.5:1 (≥ 3:1 en texto grande); placeholders legibles.
- Navegación completa por teclado con **foco visible** (anillo de acento).
- Respeto a `prefers-reduced-motion`: toda animación tiene alternativa de
  crossfade/instantánea.
- No depender solo del color para comunicar estado (icono/texto además del color).
- Áreas táctiles cómodas para el uso en móvil del vendedor.
