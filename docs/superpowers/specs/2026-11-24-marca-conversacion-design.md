# Marca «Conversación» en la web y el panel

Aprobado el 24-11-2026 («me gustó el conversación y gigante, sus colores más que nada, rediseñemos la web en eso» → «dale, aplícalo», en todo).

## Por qué

La marca «Noir telemetría» (negro, lima, cian neón, 0 px, rejilla, letra mono) se ve cyberpunk y no funciona en papelería, stands y publicaciones. La nueva sale del logo: el hueco de la D es un globo de chat.

## Qué cambia

- **Colores**: petróleo `#0b3a45`, lima `#e2f80d`, niebla `#e3edec` y blanco. Lima actúa y responde; el aguamarina (antes cian neón) mide.
- **Letra**: Gabarito titula (se parece a la del logo), Hanken Grotesk trabaja. JetBrains Mono queda para código y claves.
- **Formas**: el globo del logo (una esquina chica, las otras grandes y la cola) y esquinas suaves. Fuera el bisel, la rejilla, las crucetas «[ + ]», los hexágonos y las etiquetas en mono mayúscula.
- **Portada**: los globos de los clientes y el globo lima que contesta con el titular; secciones en petróleo, niebla y blanco; la comparación como conversación; el cierre con el globo gigante cortado.
- **Claro y oscuro** siguen. Sin elegir, oscuro (petróleo noche).

## Lo que no cambia

Textos, precios, demo interactiva, estructura del panel, nombres de las fichas CSS (`--cyan`, `--noir`…: miles de usos; cambia el valor, no el nombre).

## Reglas

- En noviembre se quitaron los bloques lima porque saturaban: la lima grande va solo en el titular y el cierre de la portada.
- Cada color de texto se lee a 4,5:1 sobre su fondo, en los dos temas.
- Los radios salen de fichas (`--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-pill`).

## Opciones que se miraron

1. Solo la parte pública: el cliente pasaría de una web petróleo a un panel negro neón.
2. Solo los colores, sin formas: quedaban el bisel y la rejilla, que son lo cyberpunk.
3. **Todo, por fichas** (elegida).

## Pasos

1. Fichas, letra y formas en `globals.css`; radios originales desde `f5db6bd`.
2. Portada, precios, documentación, login, registro y puesta en marcha.
3. Correos, icono, imagen al compartir y capturas de la portada.
4. Contraste de todas las pantallas en los dos temas, escritorio y celular; `DESIGN.md` y `theme.test.ts`.
