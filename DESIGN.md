---
name: Driony
description: CRM para WhatsApp con agentes IA — la sala de control del vendedor, en noche, Lemon y Super Sonic
colors:
  lemon: "#fefd14"
  lemon-hover: "#ffff66"
  lemon-press: "#e3e210"
  lemon-ink: "#060e1c"
  super-sonic: "#0b6cd8"
  blue-soft: "#0b6cd838"
  bubble-out: "#08448d"
  sea-angel: "#9ab9c2"
  whatsapp: "#25d366"
  positive: "#7ee2a8"
  positive-soft: "#7ee2a824"
  warning: "#f0b45a"
  warning-soft: "#f0b45a24"
  danger: "#f08a8a"
  danger-soft: "#f08a8a24"
  bg: "#060e1c"
  panel: "#0c1829"
  panel-deep: "#0a1424ed"
  sidebar: "#060e1c"
  field: "#03081299"
  surface: "#9ab9c212"
  surface-2: "#9ab9c21f"
  surface-3: "#9ab9c22e"
  bubble-in: "#16263c"
  border: "#9ab9c229"
  border-strong: "#9ab9c257"
  ink: "#f2f7f9"
  muted: "#9ab9c2"
  placeholder: "#86a6b0"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 1.6rem + 4vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.3rem + 2.6vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
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
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  overline:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "1.2px"
  mono:
    fontFamily: "ui-monospace, JetBrains Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.88em"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  control-sm: "7px"
  control: "8px"
  surface: "12px"
  dialog: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.lemon}"
    textColor: "{colors.lemon-ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.lemon-hover}"
    textColor: "{colors.lemon-ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-soft:
    backgroundColor: "{colors.blue-soft}"
    textColor: "{colors.lemon}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "18px"
  chip:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-positive:
    backgroundColor: "{colors.positive-soft}"
    textColor: "{colors.positive}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.surface}"
    padding: "9px 12px"
  nav-item-active:
    backgroundColor: "{colors.blue-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "9px 12px"
  segmented:
    backgroundColor: "{colors.field}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "3px"
  bubble-out:
    backgroundColor: "{colors.bubble-out}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "9px 12px"
  bubble-in:
    backgroundColor: "{colors.bubble-in}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "9px 12px"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "22px"
  toast:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "12px 14px"
---

# Design System: Driony

## 1. Overview

**Creative North Star: "La Sala de Control, en noche y neón"**

Driony es el puesto de mando del vendedor: una sala a oscuras donde toda la
operación —conversaciones en vivo, oportunidades, campañas— está a la vista y bajo
control. El fondo es **Noche** (#060e1c), un casi negro con el matiz del azul de la
marca y un solo brillo muy bajo de Super Sonic arriba a la izquierda. Los paneles
son planos y un punto más claros (#0c1829); lo estructural que flota sobre contenido
que se mueve (cabecera, cajones, diálogos) es cristal y desenfoca lo de detrás.

La paleta sale de tres Pantone con oficios separados. **Lemon Tonic** (#fefd14) es
la acción y la selección: botón primario, ítem activo del menú, enlaces, foco.
**Super Sonic** (#0b6cd8) es el bloque, el gráfico y el tinte: la voz del negocio en
el chat, las series de datos y el fondo de lo seleccionado. **Sea Angel** (#9ab9c2)
es el texto secundario y los neutros. Juntos hacen el póster; por separado, cada uno
significa siempre lo mismo.

El sistema es **denso pero legible**: muchos hilos, tarjetas y métricas a la vez,
con jerarquía y aire suficiente. La energía viene del contraste entre esos tres
colores y del movimiento táctil, no de más color. Rechaza el **SaaS genérico de
plantilla**, lo **colorido/infantil** y lo **corporativo frío/anticuado**. Si una
pantalla pudiera ser de cualquier otro SaaS, falló.

**Key Characteristics:**
- Noche casi plana; los paneles se separan por tono y un filete de Sea Angel.
- Lemon para actuar, Super Sonic para llenar, Sea Angel para matizar.
- Bloques de color pleno solo donde mandan: la fila de KPI del panel, la banda y el cierre de la landing.
- El verde es señal de WhatsApp y de estado positivo, nunca decoración.
- Dos familias con oficios separados: Bricolage Grotesque titula, Hanken Grotesk trabaja.
- Estados siempre explícitos (color + icono o palabra), nunca solo color.

## 2. Colors

Noche como escenario y tres colores que no se pisan el oficio. El contraste decide
quién va sobre quién, y las cifras de abajo están medidas.

### Primary
- **Lemon Tonic** (#fefd14, Pantone 12-0645 TN): acción y selección. Botón primario,
  ítem activo del menú, enlaces, foco, marcador de la fila activa, segunda serie de
  los gráficos, palabra clave del titular. 17,7:1 sobre Noche.
- **Lemon Claro** (#ffff66) y **Lemon Hundido** (#e3e210): hover y `:active` del
  botón primario. Nunca como colores sueltos.
- **Tinta Noche** (#060e1c): el texto que va encima de Lemon (botones, insignias,
  ítem activo, cierre de la landing). 17,7:1.

### Secondary
- **Super Sonic** (#0b6cd8, Pantone 18-4143 TCX, ajustado un punto desde #0c6fdc para
  que el amarillo llegue a AA): bloques y datos. Primera serie de los gráficos, KPI
  azul, banda de la landing, estallido de puntos. Encima lee Lemon (4,64:1) o blanco
  (5,06:1). Como trazo sobre Noche da 3,82:1, válido para gráficos, no para texto.
- **Azul Tenue** (Super Sonic al 22%): el fondo de lo seleccionado, de los botones
  suaves y de la fila activa. Lleva texto Lemon o Tinta.
- **Burbuja Saliente** (#08448d): Super Sonic hondo, para leer largo: blanco 9,2:1 y
  la hora en Sea Angel 4,5:1.
- **Verde WhatsApp** (#25d366): exclusivo de lo que es WhatsApp. Es herencia, no acento.
- **Verde Vital** (#7ee2a8) y **Verde Tenue**: estado positivo (entregado, ganado, opt-in).

### Tertiary (estados)
- **Ámbar** (#f0b45a) y **Ámbar Tenue**: advertencia y pendiente.
- **Rojo Suave** (#f08a8a) y **Rojo Tenue**: error, perder, opt-out, destructivo.

### Neutral
- **Noche** (#060e1c): el lienzo.
- **Panel** (#0c1829): tarjetas y paneles, opaco.
- **Panel Hondo** (#0a1424 al 93%): cajones, diálogos y barras pegajosas, con desenfoque.
- **Campo** (#030812 al 60%): el interior de inputs y selects, con borde visible (Sea Angel al 42%).
- **Capa 1 / 2 / 3** (Sea Angel al 7%, 12% y 18%): superficies sobre el panel y chips neutros.
- **Borde** (Sea Angel al 16%) y **Borde Fuerte** (al 34%): hairline; el fuerte en hover y foco.
- **Tinta** (#f2f7f9): texto principal, 16,5:1 sobre el panel.
- **Sea Angel** (#9ab9c2, Pantone 14-4315 TCX): texto secundario, etiquetas y metadatos,
  8,6:1 sobre el panel. También el tercer bloque de KPI, con tinta #142a3a (7,1:1).
- **Placeholder** (#86a6b0): el mínimo legible dentro de un campo (7,4:1).

### Named Rules
**La Regla de los Tres Oficios.** Lemon actúa, Super Sonic llena, Sea Angel matiza.
Un color no hace el trabajo de otro. Si dos cosas Lemon compiten por atención, una de
las dos no debería ser Lemon.

**La Regla de la Tinta Noche.** Sobre Lemon el texto va siempre en Tinta Noche, nunca
en blanco (1,1:1).

**La Regla del Tinte Azul.** Los tintes translúcidos son de Super Sonic o de Sea
Angel. Lemon translúcido sobre Noche se vuelve oliva: ni tintes ni estados
desactivados en amarillo. Un primario desactivado va en Capa 2 con texto Sea Angel.

**La Regla del Bloque Legible.** Dentro de un bloque de color pleno cada tono redefine
sus tokens (`--text`, `--muted`, `--positive`, `--danger`) para que todo lea a 4,5:1.
Sobre Sea Angel ni Lemon (1,9:1) ni Super Sonic (2,3:1) son texto: ahí escribe la
tinta. Un verde sobre azul o un gris sobre amarillo no pasan.

**La Regla de la Tinta Automática.** Las etiquetas y fuentes llevan colores que elige
el usuario: el texto encima lo decide `readableInk()` (`lib/readable-ink.ts`), nunca un
color fijo.

**La Regla del Verde Reservado.** El verde solo dice dos cosas: «esto es WhatsApp» o
«esto salió bien». Jamás en un botón primario, un titular o un adorno.

**La Regla del Estado Doble.** Ningún estado se comunica solo con color: siempre color
**+** icono o palabra.

## 3. Typography

**Display Font:** Bricolage Grotesque (500/600/700), con Hanken Grotesk y el
sistema de respaldo. Titula en toda la web: landing, docs y app.
**Body Font:** Hanken Grotesk (400/500/600/700), con el stack del sistema de
respaldo. Todo lo que no es titular.
**Label/Mono Font:** monoespaciada del sistema (JetBrains Mono, SF Mono, Menlo,
Consolas) para código, ids y URLs.

**Character:** una sola pareja para todas las superficies, cargada una vez en
`app/fonts.ts` y expuesta como `--font-display` y `--font-sans`: una display
con carácter (expresiva, con ligaduras vivas) y una humanista neutra para
trabajar. Contraste por eje expresiva/neutra, fuera de las fuentes-reflejo. La
display aparece solo donde hay titular: h1–h3, el título de página de la
cabecera, la marca «Driony», los números de paso de la landing. Todo lo demás
—botones, campos, etiquetas, datos, mensajes— es Hanken. Así el paso de la
landing a `/register` no cambia de voz. Si la descarga falla en el build, el CSS
cae al stack del sistema sin romper nada.

### Hierarchy
- **Display** (700, clamp(2.5rem, 1.6rem + 4vw, 4.5rem), 1.04, -0.025em): solo el
  titular del hero de la landing. Techo 4.5rem; espaciado nunca por debajo de -0.03em.
- **Headline** (700, clamp(1.9rem, 1.3rem + 2.6vw, 3rem), 1.08, -0.02em): títulos de
  sección de la landing y de los docs.
- **Title** (700, 16px, 1.25, -0.01em): título de página en la cabecera de la app,
  títulos de tarjeta y de cajón. En la app la escala es fija, no fluida.
- **Body** (400, 14px, 1.5): texto general, mensajes, filas. Prosa a 65–75ch; en la
  landing el cuerpo sube a 17px/1.6.
- **Label** (500, 12.5px): etiquetas de formulario, metadatos, subtítulo de cabecera.
- **Overline** (600, 10.5px, +1.2px, mayúsculas): **solo** los rótulos de grupo de
  la barra lateral («Ventas», «Automatización»).
- **Mono** (0.88em): chips de código con fondo Campo y borde.

### Named Rules
**La Regla de las Dos Familias.** Bricolage Grotesque titula, Hanken Grotesk trabaja.
Prohibida la display en botones, etiquetas, campos o datos; prohibida Hanken en el h1
del hero.

**La Regla del Overline Confinado.** Las mayúsculas tracked viven únicamente en los
rótulos de grupo del nav. No son un eyebrow para poner sobre cada sección.

**La Regla del Titular Sólido.** Los titulares se enfatizan con peso, tamaño o un
solo color plano. Nunca con degradado en el texto.

## 4. Elevation

Sistema **de cristal por capas**: la profundidad la dan la transparencia, la
línea de luz del borde superior y el desenfoque, no sombras oscuras. Cada capa se
lee por cuánto brillo del fondo deja pasar: fondo (todo el brillo) → tarjeta de
cristal (parte) → cajón o diálogo (casi nada, y desenfoca lo de detrás). Las
sombras existen, pero son largas y muy suaves: separan sin dibujar un contorno
gris. El halo Lemon es la excepción luminosa, y solo para acción y foco.

### Shadow Vocabulary
- **Línea de luz** (`inset 0 1px 0 rgba(255,255,255,.05)`): el borde superior de
  todo cristal (tarjetas, cajones, diálogos, ítem activo). Es lo que hace leer la
  superficie como vidrio y no como placa gris.
- **Sombra de tarjeta** (`0 12px 32px -20px rgba(0,0,0,.75)` + línea de luz): tarjetas
  en reposo. Larga y negativa: separa sin gritar.
- **Sombra de overlay** (`0 30px 70px -24px rgba(0,0,0,.8)` + línea de luz): menús,
  popovers, diálogos.
- **Sombra de cajón** (`-24px 0 70px -24px rgba(0,0,0,.8)`): paneles laterales
  (playground, asistente, detalle de oportunidad).
- **Halo de acento** (`0 0 0 1px rgba(254,253,20,.3), 0 10px 26px -12px rgba(254,253,20,.4)`):
  botón primario en reposo; crece en hover. El foco de campos combina borde Lemon con
  un anillo de 3px en Azul Tenue y un resplandor azul corto.
- **Desenfoque de cristal** (`backdrop-filter: blur(18px) saturate(160%)`): barra
  lateral, cabecera, cajones, diálogos, menús flotantes, avisos y barras pegajosas.
  Los fondos de modal desenfocan la página con `blur(6px)`.

### Named Rules
**La Regla del Cristal Estructural.** Solo desenfoca lo que flota sobre contenido
que se mueve: menú, cabecera, cajones, diálogos, menús, avisos. Las tarjetas son
translúcidas pero **nunca** llevan `backdrop-filter`: además de ser decoración, un
desenfoque convierte a la tarjeta en contenedor de sus modales `position: fixed` y
los recorta.

**La Regla del Halo con Sentido.** El resplandor Lemon solo aparece en la acción
principal, en el foco y en la selección activa. Un halo en algo que no se puede
pulsar miente.

**La Regla Anti Ghost-Card.** Una superficie se separa por transparencia y línea de
luz, o por sombra; nunca por `border: 1px solid` más una sombra ancha compitiendo.
Si una tarjeta lleva borde, su sombra es la larga y negativa de arriba o ninguna.

## 5. Components

Carácter general: **táctil y con luz propia**. El hover aviva, la pulsación hunde 1px,
el foco enciende un anillo Lemon. Sin floritura; una herramienta que responde.

### Buttons
- **Shape:** esquinas suaves (8px, `{rounded.control}`); compacto 7px; en la landing,
  pastilla (999px).
- **Primary:** Lemon plano con una luz blanca arriba (20%), Tinta Noche, peso 600,
  padding 9px 16px, Halo de acento. Hover: Lemon Claro y halo más largo; `:active` Lemon
  Hundido. En la app muchos botones llevan el fondo inline (`background: var(--accent)`);
  `globals.css` los reconoce por ese estilo en sus dos formas (con espacio, del navegador,
  y sin espacio, del HTML del servidor) y les fuerza la Tinta Noche.
- **Ghost:** transparente, borde Borde, texto Tinta; hover rellena y sube a Borde Fuerte.
- **Soft:** Azul Tenue con texto Lemon y borde azul. Para acciones destacadas que no son
  la principal (Copiloto, Probar, Asistente).
- **Danger:** transparente con texto y borde rojo; hover tiñe de Rojo Tenue. Los botones
  inline se reconocen por `var(--danger-border)`.
- **Focus:** anillo `outline` 2px Lemon con offset 2px en todo lo pulsable.
- **Disabled:** Capa 2 con texto Sea Angel en el primario (Regla del Tinte Azul); 55% de
  opacidad en el resto.
- **Landing:** primario en pastilla, Lemon con Tinta Noche; sobre el cierre en Lemon se
  invierte (noche con texto Lemon) y el secundario es contorno noche.

### Chips
- **Style:** pastilla (999px), 11–13px, `inline-flex` con icono de 10px si lo lleva.
  Neutro = Capa 3 con texto Tinta. Positivo = Verde Tenue + Verde Vital. Advertencia = Ámbar
  Tenue + Ámbar. Etiquetas y fuentes = su color propio a tono pleno, con `readableInk()`.
- **State:** filtro seleccionado = Lemon pleno con Tinta Noche; no seleccionado =
  transparente + Borde, texto Sea Angel.

### Cards / Containers
- **Corner Style:** 12px (`{rounded.surface}`); diálogos 14px.
- **Background:** Panel opaco sobre Noche.
- **Shadow Strategy:** línea de luz + sombra larga y negativa. Sin `backdrop-filter`
  (Regla del Cristal Estructural).
- **Border:** Borde de 1px hairline.
- **Internal Padding:** 18px (tarjeta) / 16px (paneles compactos).

### KPI del panel (componente firma)
La fila de métricas de `/dashboard`: tres bloques de color pleno y el resto en Panel.
Conversaciones en Super Sonic (volumen), Ventas ganadas en Lemon (el dinero, lo que más
se mira), Primera respuesta en Sea Angel (velocidad). Se pintan con `data-tone`, que
redefine los tokens dentro del bloque (Regla del Bloque Legible). Es la única rejilla de
tarjetas con color de fondo: fuera de aquí, el bloque pleno no se usa en la app.

### Gráficos
Dos series: Super Sonic (`--chart-1`) y Lemon (`--chart-2`), el contraste del póster. El
verde solo para ventas ganadas, por significado. Mapa de calor y embudo en tintes de Super
Sonic. Nunca otro color entre medias.

### Inputs / Fields
- **Style:** fondo Campo, borde Sea Angel al 42%, radio 8px, texto Tinta. Placeholder
  #86a6b0. El select lleva su propia flecha y la lista desplegada es opaca (#0c1829).
- **Focus:** borde Lemon + anillo azul de 3px + resplandor corto. Caret Lemon.
- **Hover:** borde sube a Borde Fuerte.
- **Error / Disabled:** error en Rojo Suave; disabled al 60% con `not-allowed`.
- **Segmentado:** contenedor Campo; el segmento activo es Capa 2 con línea de luz.

### Navigation
- **Style:** barra lateral de 226px en Noche, con filete a la derecha; grupos con Overline;
  ítem = icono de línea (18px, trazo 1.75) + etiqueta 14px/500, radio 12px.
- **States:** default Sea Angel; hover Tinta + Capa; **activo** = Lemon pleno con Tinta Noche
  y peso 600. La insignia sobre el activo se invierte (noche con texto Lemon).
- **Estallido:** en pantallas de más de 1040px de alto asoma al pie del menú, detrás de todo.
- **Cabecera:** cristal desenfocado con una línea Super Sonic que recorre su borde inferior
  y se apaga; título en la display; avatar Lemon con Tinta Noche.
- **Móvil:** el menú se pliega y sale como cajón con fondo desenfocado (montado con portal).

### Marca
`components/BrandMark.tsx`: «DRIONY» en mayúsculas (display 700, +0.05em) con la «O» como un
círculo en tres franjas: Sea Angel, Lemon y Super Sonic. La «O» sola es el favicon. Se lee
como «Driony» (`role="img"`). El producto se sigue escribiendo «Driony» en el texto corrido.

### Estallido
`public/landing/estallido.webp`: una explosión de puntos en Super Sonic con fondo
transparente, generada por código con semilla fija. Es el único adorno de la marca: detrás
de la conversación en el hero, asomando en el cierre (el azul sobre el amarillo) y al pie del
menú si hay sitio. Nunca detrás de texto suelto: lo que flota encima lleva superficie opaca.

### Burbuja de mensaje
El corazón de la bandeja. Saliente = Burbuja Saliente con texto blanco, a la derecha; entrante
= #16263c, a la izquierda. Estado de entrega con icono (check, doble check, reloj); leído en
Lemon. Acciones al pasar el cursor o al enfocar con teclado. Fila de conversación: avatar con
iniciales, vista previa, contador Lemon con Tinta Noche y chip de espera que pasa a ámbar a la
hora; la fila activa lleva Azul Tenue y el marcador Lemon de 3px.

### Banda y cierre (landing)
Marquesina a todo ancho en Super Sonic con letra Lemon en mayúsculas (se pausa al pasar el
cursor y se detiene con `prefers-reduced-motion`). El cierre es la pareja: Lemon a sangre con
Tinta Noche, botón invertido y el estallido asomando por la derecha.

### Conversación en vivo (hero de la landing)
Una venta de principio a fin: el chat y al lado el registro de lo que hace el CRM, ambos sobre
superficie opaca porque flotan sobre el estallido. Se reproduce una vez al cargar y se repite
con «Ver otra vez». El HTML del servidor trae el estado final, así que sin JS o con movimiento
reducido se ve completa.

### Tema claro de la landing
El selector de la cabecera ofrece el póster: lienzo Sea Angel plano, tinta #07233f, primario
Super Sonic con letra Lemon y la palabra clave marcada en Lemon. La app no tiene tema claro.

## 6. Do's and Don'ts

### Do:
- **Do** usar Lemon (#fefd14) para acción, foco y selección, siempre con Tinta Noche encima.
- **Do** usar Super Sonic para bloques, datos y tintes, y Sea Angel para el texto secundario.
- **Do** redefinir los tokens dentro de un bloque de color y medir el contraste (Regla del
  Bloque Legible).
- **Do** pasar los colores que elige el usuario por `readableInk()`.
- **Do** reservar el verde (#25d366 / #7ee2a8) a lo que es WhatsApp y a los estados positivos.
- **Do** comunicar todo estado con color **+** icono o palabra.
- **Do** desenfocar solo lo estructural: menú, cabecera, cajones, diálogos, menús, avisos.
- **Do** montar con portal cualquier cosa `position: fixed` que nazca dentro de un elemento con
  `backdrop-filter`.
- **Do** dar respuesta táctil: hover que aviva, `:active` que hunde 1px, anillo de foco Lemon.
- **Do** titular con Bricolage Grotesque y trabajar con Hanken Grotesk.
- **Do** texto de cuerpo a ≥4.5:1; placeholders a #86a6b0, nunca gris fantasma.
- **Do** usar iconos SVG de línea (18px, trazo 1.75); los emojis solo dentro de los mensajes.
- **Do** respetar `prefers-reduced-motion`: toda animación tiene alternativa.

### Don't:
- **Don't** caer en **SaaS genérico de plantilla**: rejillas de tarjetas idénticas o todo gris.
  La fila de KPI con color es la excepción y no se copia a otras pantallas.
- **Don't** volverlo **colorido/infantil**: arcoíris de colores ni emojis por todos lados.
- **Don't** parecer **corporativo frío/anticuado**: azules rígidos ni tablas de los 2000.
- **Don't** usar Lemon translúcido ni en estados desactivados: sobre Noche es oliva.
- **Don't** escribir en Lemon ni en Super Sonic sobre Sea Angel: no llegan a 3:1.
- **Don't** poner texto blanco sobre Lemon, ni verde sobre azul, ni gris sobre amarillo.
- **Don't** poner texto suelto sobre el estallido: lo que flota encima lleva superficie opaca.
- **Don't** poner `backdrop-filter` en tarjetas ni usar el cristal como decoración.
- **Don't** usar degradado en el texto de titulares ni en la marca.
- **Don't** repetir eyebrows en mayúsculas sobre cada sección; el overline vive en el nav.
- **Don't** usar `border-left`/`border-right` mayor de 1px como raya decorativa. Las únicas
  son el marcador de la fila activa de la bandeja y la cita dentro de una burbuja.
- **Don't** parear `border: 1px solid` con `box-shadow` de blur ≥16px positivo en la misma
  tarjeta o botón (ghost-card).
- **Don't** redondear tarjetas o campos a 24/28/32px+. Techo: 12px en superficies, 14px en
  diálogos; pastilla solo en chips y en los botones de la landing.
- **Don't** usar el verde en botones primarios, titulares o adornos.
- **Don't** animar propiedades de layout salvo el pliegue del menú; las transiciones son de
  120–250 ms y comunican estado, no decoran.
