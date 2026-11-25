---
name: Driony
colors:
  petrol: "#0b3a45"
  petrol-night: "#07303a"
  petrol-deep: "#06272f"
  lemon: "#e2f80d"
  lemon-hover: "#edff45"
  lemon-press: "#cfe500"
  lemon-ink: "#0b3a45"
  mist: "#e3edec"
  mist-bg: "#edf4f3"
  aqua: "#86dfe2"
  aqua-ink: "#0a6672"
  smoke: "#a5c4c7"
  whatsapp: "#25d366"
  positive: "#7ee2a8"
  warning: "#f6c274"
  danger: "#ffa5ae"
  line: "#1c5462"
  line-light: "#cfdddb"
  bubble-out: "#15545f"
  bubble-in: "#0e424d"
  bubble-out-light: "#eefaa6"
  ink: "#eef6f5"
  muted: "#a9c7ca"
typography:
  display:
    fontFamily: "Gabarito, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 1.4rem + 3vw, 4.1rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "Gabarito, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.95rem, 1.3rem + 2.4vw, 3.1rem)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Gabarito, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  pill: "999px"
  bubble-in: "8px 20px 20px 4px"
  bubble-out: "20px 8px 4px 20px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
---

# Design System: Driony

## 1. Overview

**Creative North Star: «Conversación»**

El hueco de la D del logo es un globo de chat con cola y una estrella dentro. De ahí
sale todo: **el cliente pregunta en un globo y Driony contesta en lima**. La misma
idea vive en la tarjeta (pregunta en una cara, respuesta en la otra), en el muro de
un stand, en una publicación, en la portada de la web y en la bandeja.

Desde el 2026-11-24 sustituye a «Noir telemetría» (negro, lima, cian neón, 0 px,
bisel, rejilla y letra mono), que se leía cyberpunk y no funcionaba en papelería,
stands ni publicaciones. La aplicación fuera de pantalla está en
`Documentos/Driony marca`.

La **landing** alterna secciones en petróleo, niebla y blanco, con el globo lima en el
titular y el globo gigante, cortado por el borde, en el cierre. El **panel** es denso
pero legible: los mismos colores, superficies planas con filete y esquinas suaves.

**Key Characteristics:**
- Petróleo de fondo y de tinta; lima para lo que se pulsa y para lo que Driony responde.
- El globo del logo: una esquina chica, las otras grandes y la cola. Es la forma firma.
- Gabarito titula (se parece a las letras del logo), Hanken trabaja, JetBrains Mono solo es código.
- Esquinas siempre de las fichas `--r-*`. Superficies planas: ni bisel, ni rejilla, ni halos.
- Claro y oscuro con las mismas reglas. Sin elegir, oscuro.
- Estados siempre explícitos (color + icono o palabra), nunca solo color.

## 2. Colors

Los nombres de las fichas CSS `--noir`, `--cyan` y `--smoke` son de la marca anterior y
se quedan (miles de usos): hoy valen petróleo, aguamarina y niebla.

### Primary
- **Lima** (#e2f80d): el botón principal, lo elegido, el ítem activo del menú, el foco en
  oscuro y la respuesta de Driony en la landing. 10,4:1 con petróleo encima.
  Hover #edff45, `:active` #cfe500.
- **Petróleo** (#0b3a45): la tinta sobre lima y en claro, el panel en oscuro y las
  secciones oscuras de la landing. Blanco encima, 12,3:1.

### Secondary
- **Aguamarina** (#86dfe2; en claro #0a6672 como texto): datos, presencia y lo que está en
  marcha. Primera serie de los gráficos, IA activa, botón suave. **Nunca para actuar.**
- **Niebla** (#e3edec, fondo claro #edf4f3; en oscuro, el texto secundario #a9c7ca): los
  neutros y el globo del cliente.

### Tertiary (estados)
- **Verde** (#7ee2a8 / claro #0a6b3d), **Ámbar** (#f6c274 / #845000) y **Rojo** (#ffa5ae /
  #b3122f). El **verde WhatsApp** (#25d366) solo dice «esto es WhatsApp».

### Neutral
- Oscuro: lienzo #07303a, panel #0b3a45, barra lateral #06272f, filete #1c5462, texto #eef6f5.
- Claro: lienzo #edf4f3, panel #ffffff, filete #cfdddb, texto #0b3a45, secundario #3f626a.

### Named Rules
**La Regla de la Respuesta.** La lima grande (un bloque) solo aparece cuando Driony
contesta: el globo del titular y el del cierre de la landing. En noviembre se quitaron
los bloques lima porque saturaban; no vuelven en ningún otro sitio.

**La Regla de la Tinta Petróleo.** Sobre lima se escribe en petróleo, nunca en blanco.

**La Regla del Lavado Bajo.** Lima translúcida sobre petróleo se vuelve oliva: solo se usa
como lavado de selección al 10 % (34 % en claro). Un primario desactivado va en Capa 2.

**La Regla Sin Oliva.** En claro, la lima no se oscurece para leerse: como texto va en
petróleo azulado (`--accent-text` #0a5c69) y como línea o foco, en petróleo
(`--accent-edge` #0b3a45).

**La Regla del Bloque Legible.** Dentro de un bloque de color cada tono redefine sus fichas
(`--text`, `--muted`, `--positive`…) para que todo lea a 4,5:1. En la landing lo hacen las
zonas `.lp-petrol` y `.lp-lime`.

**La Regla de la Tinta Automática.** Los colores que elige el usuario llevan encima la tinta
de `readableInk()` (`lib/readable-ink.ts`), nunca una fija.

**La Regla del Estado Doble.** Ningún estado se comunica solo con color.

**La Regla de la Ficha.** Nunca un color suelto en un componente: una ficha,
`rgb(var(--cyan-rgb) / 0.1)` para los tintes o `light-dark(claro, oscuro)`. Lo vigila
`test:theme`.

### Claro y oscuro
Cookie `driony_theme` (`lib/theme.ts`): Claro, Oscuro o Automático. La landing usa las mismas
fichas bajo `.lp`; las zonas en petróleo y en lima son iguales en los dos.

## 3. Typography

**Display:** Gabarito (variable), geométrica y redonda como las letras del logo.
**Body:** Hanken Grotesk (400/500/600/700).
**Mono:** JetBrains Mono, **solo** código, claves y lo que se copia tal cual.

### Hierarchy
- **Display** (600, hasta 4,1rem, 1.02): el titular de la landing, una frase por línea.
- **Headline** (600, hasta 3,1rem): títulos de sección. El del cierre llega a 4,4rem.
- **Title** (700, 16px): título de página y de tarjeta en la app. Escala fija.
- **Body** (400, 14px, 1.5): la app. En la landing, 17px/1.6 y 54–64ch.
- **Label** (600, 12,5px): etiquetas, cabeceras de tabla y leyendas, en caja normal y con
  cifras tabulares.

### Named Rules
**La Regla de la Caja Normal.** Nada va en mayúsculas por estilo: ni etiquetas, ni grupos del
menú, ni cabeceras. Solo las siglas (CRM, ARM, IA).

**La Regla del Titular Sólido.** Se enfatiza con tamaño y con el globo, nunca con degradado ni
con una palabra de otro color.

## 4. Elevation

Plano. Una superficie se separa por tono y filete de 1px; lo que flota lleva
`--shadow-overlay` (filete y una sombra corta). Ni cristal, ni halos, ni luz en los botones.

**La Regla del Radio.** Todo radio sale de una ficha: `--r-sm` 8 (miniaturas, filas pequeñas),
`--r-md` 12 (botones, campos, tarjetas pequeñas), `--r-lg` 16 (tarjetas, diálogos),
`--r-xl` 22 y `--r-pill` (filtros, etiquetas, interruptores). En la landing, botones en
píldora. Los mensajes llevan `--bubble-in-r` y `--bubble-out-r`.

## 5. Components

Carácter: **cercano y preciso**. El hover aviva, la pulsación hunde 1px y el foco enciende un
contorno de 2px.

### El globo (firma)
`.lp-bub` (cliente, cola a la izquierda) y `.lp-bub--out` (Driony, a la derecha) en la landing;
la cola es una máscara SVG (`--tail`) pintada con el color del globo (`--fill`), y el tamaño va
en `--b1`, `--b2` y `--t`. En la bandeja los mensajes usan la misma forma sin cola.

### Buttons
- **Primary:** lima plana, tinta petróleo, peso 600. En la app muchos llevan el fondo inline
  (`background: var(--accent)`); `globals.css` los reconoce y les fuerza la tinta. Dentro de
  un bloque lima se invierte solo (petróleo con blanco).
- **Ghost:** transparente con filete. **Soft:** aguamarina tenue, para lo que ayuda (Copiloto,
  Asistente, Probar). **Danger:** texto y borde rojos.
- **Disabled:** Capa 2 con texto secundario en el primario; 55 % en el resto.

### Chips y filtros
Píldora. Neutro = Capa 3; positivo, ámbar y rojo en sus tenues; etiquetas y fuentes, su color
propio con `readableInk()`. El filtro elegido, lima llena.

### KPI del panel
Tres bloques y el resto en panel: Conversaciones en petróleo (claro) o niebla (oscuro), Ventas
ganadas en lima y Primera respuesta en niebla o petróleo claro. Se pintan con `data-tone`, que
redefine las fichas de dentro. Es la única rejilla de tarjetas con color de fondo.

### Gráficos
Dos series: aguamarina (`--chart-1`) y lima (`--chart-2`). El verde, solo para ventas ganadas.

### Campos
Fondo Campo, filete `--field-border`, `--r-md`, sin sombra. Foco: borde y anillo de 3px en
`--accent-soft`. El select lleva su flecha y su lista es opaca.

### Navegación
Barra lateral con grupos en 12px sin mayúsculas. Activo = lima llena con tinta petróleo; su
insignia se invierte. Alrededor del avatar va el consumo de IA del mes en un anillo de 2px
(aguamarina, ámbar desde el 80 %, rojo al tope); el botón «Copiloto» lleva el mismo anillo con
las preguntas gratis del mes, que se vacía. En el celular el menú sale como cajón (portal).

### Correo
Los del sistema (`system-email.ts`): cabecera petróleo, filete lima, tarjeta blanca y botón lima
en píldora. La **vista previa** de los de cada empresa va siempre en claro: así la verá quien lo
reciba.

### Franja de ventana y simulador
La franja de 24 h (`fu-*`) y las conversaciones simuladas (`sim-*`) usan las mismas fichas:
aguamarina dentro de la ventana o en curso, ámbar si pasó a una persona, rojo si falló. Los
mensajes, con la forma del globo.

### Marca
`components/BrandMark.tsx` e `app/icon.svg`: el logo de noviembre de 2026, la «D» en
lima con la chispa dentro y «riony» en minúsculas. Las letras van en `currentColor`
(blanco sobre petróleo, petróleo sobre lima y en claro); la D en lima, salvo sobre lima o
en papel, donde el contenedor pone `--wordmark-mark` en tinta para que no desaparezca. Los
trazados vienen del archivo original recortados a su caja (432 × 122; la D sola,
124 × 122), nunca con el lienzo tamaño carta alrededor. La D sola es el favicon, sobre
una loseta petróleo redondeada para verse en pestañas claras. Se lee como «Driony»
(`role="img"`). El producto se sigue escribiendo «Driony» en el texto corrido.

### Portada
Dos columnas: los globos de los clientes con su hora y el globo lima con el titular, el texto y
los botones; su cola cae sobre la demo (`HeroDemo.tsx`), que el visitante maneja y va con la
etiqueta «Datos de ejemplo». En el celular los globos van en fila y el titular debajo. El rótulo
«CRM tachado → ARM» cae con el sello. La captura de la bandeja sigue al tema
(`bandeja.webp` / `bandeja-claro.webp`).

### Qué es ARM
Las letras ARM en tinta con la sombra dura en lima, que se despega con el scroll, y las tres
claves en globos de niebla.

### Antes y después
Una conversación en petróleo: «WhatsApp a mano» a la izquierda, «ARM con Driony» a la derecha en
blanco con el visto en lima. Sigue siendo una tabla para lectores de pantalla.

### Planes
Tarjetas blancas (o panel); el recomendado en petróleo con su rótulo en lima.

### Cierre
`.lp-end`: petróleo con el globo gigante lima cortado por el borde derecho y el logo abajo.

## 6. Do's and Don'ts

### Do:
- **Do** usar lima para actuar, para lo elegido y para la respuesta, con tinta petróleo encima.
- **Do** redefinir las fichas dentro de un bloque de color y medir el contraste.
- **Do** pasar los colores que elige el usuario por `readableInk()`.
- **Do** comunicar todo estado con color **+** icono o palabra.
- **Do** texto de cuerpo a ≥4,5:1 en los dos temas; los campos vacíos también.
- **Do** iconos SVG de línea (18px, trazo 1.75); los emojis solo dentro de los mensajes.
- **Do** respetar `prefers-reduced-motion` y mover con el scroll desde CSS
  (`animation-timeline`), con el observador de JS solo como respaldo.
- **Do** explicar la landing con producto real (capturas y la demo).
- **Do** montar con portal lo `position: fixed` que nazca dentro de algo con `overflow`.

### Don't:
- **Don't** volver a lo cyberpunk: negro puro, cian neón, rejilla, bisel, crucetas «[ + ]»,
  hexágonos, halos ni letra mono de adorno.
- **Don't** poner más bloques lima que el titular y el cierre.
- **Don't** escribir en blanco sobre lima ni en lima sobre blanco.
- **Don't** usar lima oscurecida (oliva) ni lima translúcida por encima del lavado.
- **Don't** usar un radio que no sea de las fichas.
- **Don't** caer en **SaaS genérico de plantilla**, en lo **colorido/infantil** ni en lo
  **corporativo frío**.
- **Don't** usar mayúsculas de estilo ni rótulos sobre los títulos.
- **Don't** usar el verde ni la aguamarina para actuar.
- **Don't** animar propiedades de layout; las transiciones son de 120–250 ms y comunican estado.
