---
name: Driony
colors:
  lemon: "#e2f80d"
  lemon-hover: "#eefc4a"
  lemon-press: "#c9dd0a"
  lemon-ink: "#0a0b10"
  on-lemon-dim: "#1c2000"
  on-lemon-muted: "#3d4300"
  cyan: "#00e5ff"
  cyan-soft: "#00e5ff1a"
  bubble-out: "#0b3a45"
  smoke: "#8e9eaf"
  green: "#1f6b3b"
  whatsapp: "#25d366"
  positive: "#7ee2a8"
  positive-soft: "#7ee2a81f"
  warning: "#f0b45a"
  warning-soft: "#f0b45a1f"
  danger: "#ff3355"
  danger-soft: "#ff33551f"
  bg: "#0a0b10"
  bg-landing: "#08090b"
  panel: "#12141f"
  panel-2: "#1a1d2e"
  line: "#25293e"
  line-strong: "#3b4160"
  sidebar: "#12141f"
  field: "#0a0b10"
  surface: "#8e9eaf12"
  surface-2: "#8e9eaf1f"
  surface-3: "#8e9eaf2e"
  bubble-in: "#1a1d2e"
  ink: "#e9edf2"
  muted: "#8e9eaf"
  placeholder: "#7f8ea1"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 1.6rem + 4.2vw, 4.8rem)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Bricolage Grotesque, Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.3rem + 2.6vw, 3.1rem)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.01em"
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
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
  overline:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "1.2px"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  control: "0"
  surface: "0"
  dialog: "0"
  pill: "0"
  circle: "50%"
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
    backgroundColor: "{colors.cyan-soft}"
    textColor: "{colors.cyan}"
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
    backgroundColor: "{colors.lemon}"
    textColor: "{colors.lemon-ink}"
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

**Creative North Star: "Una marca en lima ácido, dos estilos cyberpunk"**

Driony vende en la landing y opera en el panel, y las dos caras comparten un
solo color de marca, el **Lima Ácido** (#e2f80d), sobre negro. Lo demás cambia a
propósito para que no parezcan la misma pantalla.

La **landing «Ácido»** es un póster: negro casi puro (#08090b), bloques de lima
pleno con tinta noir (el hero, la banda, la primera tile de capacidades, el
resultado de la calculadora, el plan destacado y el cierre), píxeles como motivo
(lima y Verde Circuito), titulares en Bricolage condensada y en mayúsculas, y
mono en botones, nav y rótulos. El cian aparece solo en lo que mide o está en
marcha (la IA del hero, los chips de evento, las barras, las lecturas de la
calculadora), nunca para actuar. Es el estilo de la referencia que eligió el
usuario: la estructura la hace el color, no el acento.

El **panel «Noir telemetría»** es un instrumento: negro azulado (#0a0b10) con una
rejilla muy baja cada 24px, paneles planos (#12141f) separados por filete
(#25293e), nada de cristal ni sombras difusas, esquinas a 0px y bisel (esquina
cortada) en KPI y botón primario. El lima solo actúa; el **Cian Neón** (#00e5ff)
pinta datos, presencia y lo que está en marcha; el **Humo** (#8e9eaf) es el texto
secundario y los neutros. Etiquetas, horas, estados y ejes van en JetBrains Mono
en mayúsculas: se lee como un panel de instrumentos, no como un formulario.

El sistema sigue siendo **denso pero legible**: muchos hilos, tarjetas y métricas
a la vez, con jerarquía y aire suficiente. Rechaza el **SaaS genérico de
plantilla**, lo **colorido/infantil** y lo **corporativo frío/anticuado**. Si una
pantalla pudiera ser de cualquier otro SaaS, falló.

**Key Characteristics:**
- Un solo lima para las dos caras; el cian mide en el panel y, en la landing, solo marca lo que mide (IA en marcha, eventos, barras); el Verde Circuito es solo de los píxeles.
- Landing: bloques de color pleno, píxeles, mayúsculas condensadas, mono en botones y rótulos, 0px.
- Panel: noir con rejilla, paneles planos con filete, 0px, bisel en KPI y primario, mono para la telemetría.
- Lima actúa, cian mide, humo matiza. Un color no hace el trabajo de otro.
- El verde sigue siendo señal de WhatsApp y de estado positivo; el Rojo Neón es peligro.
- Tres familias con oficio: Bricolage titula, Hanken trabaja, JetBrains Mono mide.
- Estados siempre explícitos (color + icono o palabra), nunca solo color.

## 2. Colors

Negro de escenario y tres colores que no se pisan el oficio. El contraste decide
quién va sobre quién, y las cifras de abajo están medidas.

### Primary
- **Lima Ácido** (#e2f80d): acción y selección. Botón primario, ítem activo del
  menú, enlaces, foco, marcador de la fila activa, segunda serie de los gráficos,
  el KPI que importa, y en la landing los bloques plenos. 17:1 sobre Noir.
- **Lima Claro** (#eefc4a) y **Lima Hundido** (#c9dd0a): hover y `:active` del
  botón primario. Nunca como colores sueltos.
- **Tinta Noir** (#0a0b10): el texto que va encima de lima, cian y humo. Dentro de
  un bloque lima, los grises son **#1c2000** (texto) y **#3d4300** (rótulos, 9,4:1).

### Secondary
- **Cian Neón** (#00e5ff): datos, presencia y lo que está en marcha. Primera serie
  de los gráficos, KPI de volumen, pulso de «en vivo», botón suave (Copiloto,
  Asistente, Probar), foco de los campos, tintes de selección de datos. 12,8:1
  sobre Noir: vale hasta como texto. En la landing solo en lo que mide: la
  insignia «IA» y el modo Autopilot del hero, los ticks del registro, los chips
  de evento, las barras y los valores de la calculadora. **Nunca para actuar.**
- **Cian Tenue** (cian al 10 %): fondo del botón suave y de lo seleccionado en listas.
- **Burbuja Saliente** (#0b3a45): cian hondo, para leer largo: blanco 9:1.
- **Humo** (#8e9eaf): texto secundario, etiquetas y neutros, 6,9:1 sobre Noir. Las
  Capas 1/2/3 son humo al 7 %, 12 % y 18 %. También el tercer bloque de KPI, con
  tinta noir encima.
- **Verde Circuito** (#1f6b3b): el segundo tono de los píxeles de la landing y de
  la tinta de las tiles verdes. Nunca como texto ni como acción.
- **Verde WhatsApp** (#25d366): exclusivo de lo que es WhatsApp. Es herencia, no acento.
- **Verde Vital** (#7ee2a8) y **Verde Tenue**: estado positivo (entregado, ganado, opt-in).

### Tertiary (estados)
- **Ámbar** (#f0b45a) y **Ámbar Tenue**: advertencia y pendiente.
- **Rojo Neón** (#ff3355) y **Rojo Tenue**: error, perder, opt-out, destructivo. 5,5:1 sobre Noir.

### Neutral
- **Noir** (#0a0b10): el lienzo del panel, con la rejilla de telemetría encima.
- **Negro Ácido** (#08090b): el lienzo de la landing, casi puro.
- **Panel** (#12141f): tarjetas, barras, cajones y diálogos, opacos. **Panel Alto**
  (#1a1d2e) para filas en hover y burbuja entrante.
- **Filete** (#25293e) y **Filete Fuerte** (#3b4160): hairline de toda superficie;
  el fuerte en hover.
- **Campo** (#0a0b10 con filete #30365a): el interior de inputs y selects.
- **Tinta** (#e9edf2): texto principal, 16:1 sobre el panel.
- **Placeholder** (#7f8ea1): el mínimo legible dentro de un campo (5,8:1).

### Named Rules
**La Regla de los Tres Oficios.** Lima actúa, cian mide, humo matiza. Si dos cosas
lima compiten por atención, una de las dos no debería ser lima.

**La Regla de la Tinta Noir.** Sobre lima, cian y humo el texto va siempre en Tinta
Noir, nunca en blanco. Dentro de un bloque lima, los grises son #1c2000 y #3d4300.

**La Regla del Lavado Bajo.** Lima translúcido sobre oscuro se vuelve oliva: solo
se usa como lavado de selección al 6–8 %. Los tintes de datos y foco son de cian;
los neutros, de humo. Un primario desactivado va en Capa 2 con texto humo.

**La Regla del Bloque Legible.** Dentro de un bloque de color pleno cada tono
redefine sus tokens (`--text`, `--muted`, `--positive`, `--danger`) para que todo
lea a 4,5:1. Sobre cian y sobre humo escribe la tinta.

**La Regla de la Tinta Automática.** Las etiquetas y fuentes llevan colores que
elige el usuario: el texto encima lo decide `readableInk()` (`lib/readable-ink.ts`),
nunca un color fijo.

**La Regla del Verde Reservado.** El verde solo dice dos cosas: «esto es WhatsApp»
o «esto salió bien». El Verde Circuito es exclusivo de los píxeles de la landing.

**La Regla del Cian que Mide.** El cian nunca actúa: ni botones, ni enlaces, ni
selección. En la landing aparece solo en lo que mide o está en marcha (IA,
eventos, barras, lecturas); el resto es lima y negro, como la referencia.

**La Regla del Estado Doble.** Ningún estado se comunica solo con color: siempre
color **+** icono o palabra.

## 3. Typography

**Display Font:** Bricolage Grotesque, variable con ejes `opsz` y `wdth`. Titula
en toda la web; en la landing va a 800, condensada (`font-stretch: 82 %`) y en
mayúsculas.
**Body Font:** Hanken Grotesk (400/500/600/700). Todo lo que no es titular ni
telemetría.
**Mono Font:** JetBrains Mono (400/500/700). La telemetría del panel (etiquetas de
KPI, horas, estados, ejes, chips de la consola) y, en la landing, botones, nav,
rótulos de tile, chips y banda. Siempre en mayúsculas con tracking 0.06–0.12em.

**Character:** tres familias cargadas una vez en `app/fonts.ts` y expuestas como
`--font-display`, `--font-sans` y `--font-mono`. La display aparece solo donde hay
titular; la mono solo donde se lee como instrumento; Hanken en todo lo demás, para
que el paso de la landing a `/register` no cambie de voz. Si la descarga falla en
el build, el CSS cae al stack del sistema sin romper nada.

### Hierarchy
- **Display** (800, condensada 82 %, mayúsculas, clamp(2.6rem, 1.6rem + 4.2vw, 4.8rem),
  0.96, -0.01em): el titular del hero de la landing. La palabra clave va marcada en
  un bloque de tinta con texto lima.
- **Headline** (800, condensada 82 %, mayúsculas, clamp(1.9rem, 1.3rem + 2.6vw, 3.1rem)):
  títulos de sección de la landing. Los h3 de tiles y planes a 700 y 88 %.
- **Title** (700, 16px, 1.25, -0.01em): título de página en la cabecera de la app,
  títulos de tarjeta y de cajón. En la app la escala es fija, no fluida y sin mayúsculas.
- **Body** (400, 14px, 1.5): texto general, mensajes, filas. Prosa a 65–75ch; en la
  landing el cuerpo sube a 17px/1.6.
- **Label** (mono 500, 11px, 0.08em, mayúsculas): etiquetas de KPI, cabeceras de
  tabla, chips de la consola, leyendas y ejes.
- **Overline** (600, 10.5px, +1.2px, mayúsculas): **solo** los rótulos de grupo de
  la barra lateral («Ventas», «Automatización»).
- **Mono** (700, 12.5px, 0.08em, mayúsculas): botones y nav de la landing; en la
  banda, 0.12em.

### Named Rules
**La Regla de las Tres Familias.** Bricolage titula, Hanken trabaja, JetBrains Mono
mide. Prohibida la display en botones, campos o datos; prohibida la mono en
párrafos; prohibida Hanken en el h1 del hero.

**La Regla del Overline Confinado.** En la app, las mayúsculas tracked viven en los
rótulos de grupo del nav y en la telemetría; no son un eyebrow para poner sobre
cada sección. En la landing la mono va en botones, nav, rótulos de tile y banda,
no como eyebrow de cada título.

**La Regla del Titular Sólido.** Los titulares se enfatizan con peso, tamaño, un
bloque de tinta o un solo color plano. Nunca con degradado en el texto.

## 4. Elevation

Sistema **plano y biselado**: la profundidad la dan el tono y el filete, no la
transparencia ni el desenfoque. Fondo (noir con rejilla) → panel (un punto más
claro, con filete) → lo que flota (panel con filete y una sombra corta y dura).
Las esquinas van a 0px; el bisel de 10px (esquina cortada arriba a la derecha) es
la única forma «especial», reservada a los KPI y al botón primario.

### Shadow Vocabulary
- **Filete** (`0 0 0 1px #25293e`): cómo se separa cualquier superficie.
- **Sombra de overlay** (`0 0 0 1px #25293e, 0 18px 40px -22px rgba(0,0,0,.9)`):
  menús, popovers y diálogos: filete y una sombra corta y dura.
- **Sombra de cajón** (`-1px 0 0 #25293e, -24px 0 60px -30px rgba(0,0,0,.9)`):
  paneles laterales.
- **Destello lima** (`0 0 0 1px #e2f80d, 0 0 16px rgba(226,248,13,.55)`): el
  primario en hover y pulsación, y el KPI que importa (`.dash__kpi.is-hot`).
- **Anillo de foco** (`0 0 0 3px rgba(0,229,255,.22), 0 0 22px -6px rgba(0,229,255,.7)`):
  foco de campos, en cian, con el borde cian.
- **Bisel** (`clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)`):
  KPI y botón primario. `clip-path` recorta sombras y outline, así que el foco del
  primario va por dentro (`outline-offset: -4px`).

### Named Rules
**La Regla del Cero.** Esquinas a 0px en todo, incluidos los radios en línea
(`globals.css` los fuerza con `[style*="border-radius"]`). Los círculos (avatares,
puntos de estado, 50 %) se quedan. El bisel solo en KPI y botón primario.

**La Regla del Filete.** Una superficie se separa por tono y filete, nunca por
`backdrop-filter` ni por sombra difusa. Lo que flota lleva filete y una sombra
corta y dura. Nada de cristal: `--glass-blur` es 0 y se queda así.

**La Regla del Destello con Sentido.** El destello lima solo aparece en el primario
en hover y en el KPI que importa. Un destello en algo que no se puede pulsar miente.

## 5. Components

Carácter general: **de instrumento**. El hover aviva, la pulsación hunde 1px, el
foco enciende un anillo cian en campos y un contorno lima en lo pulsable. Sin
floritura; una herramienta que responde.

### Buttons
- **Shape:** 0px en todo; el primario con bisel. En la landing, 0px y letra mono
  en mayúsculas (12.5px, 0.08em).
- **Primary:** lima plano con Tinta Noir, peso 600, padding 9px 16px, bisel. Hover:
  Lima Claro con destello; `:active` Lima Hundido. En la app muchos botones llevan
  el fondo inline (`background: var(--accent)`); `globals.css` los reconoce por ese
  estilo en sus dos formas (con espacio, del navegador, y sin espacio, del HTML del
  servidor) y les fuerza la tinta y el bisel.
- **Ghost:** transparente, Filete, texto Tinta; hover rellena y sube a Filete Fuerte.
- **Soft:** Cian Tenue con texto y borde cian. Para lo que está en marcha o ayuda
  (Copiloto, Asistente, Probar el agente).
- **Danger:** transparente con texto y borde rojo; hover tiñe de Rojo Tenue. Los
  botones inline se reconocen por `var(--danger-border)`.
- **Focus:** contorno 2px lima con offset 2px en todo lo pulsable; en el primario,
  contorno noir por dentro.
- **Disabled:** Capa 2 con texto humo en el primario (Regla del Lavado Bajo); 55 %
  de opacidad en el resto.
- **Landing:** primario lima con tinta; dentro de un bloque lima (hero, calculadora,
  plan destacado, cierre) se invierte (noir con texto lima) y el secundario es
  contorno noir.

### Chips
- **Style:** 0px, mono 11px en mayúsculas en la consola y en la landing; en la app
  11–13px Hanken. Neutro = Capa 3 con texto Tinta. Positivo = Verde Tenue + Verde
  Vital. Advertencia = Ámbar Tenue + Ámbar. Etiquetas y fuentes = su color propio a
  tono pleno, con `readableInk()`.
- **State:** filtro seleccionado = lima pleno con Tinta Noir; no seleccionado =
  transparente + Filete, texto humo.

### Cards / Containers
- **Corner Style:** 0px en todo.
- **Background:** Panel opaco sobre Noir.
- **Shadow Strategy:** ninguna en reposo; filete de 1px. Lo que flota, sombra de overlay.
- **Internal Padding:** 18px (tarjeta) / 16px (paneles compactos).

### KPI del panel (componente firma)
La fila de métricas de `/dashboard`: tres bloques de color pleno y el resto en Panel,
todos con bisel y la etiqueta en mono. Conversaciones en cian (volumen), Ventas
ganadas en lima (el dinero, lo que más se mira), Primera respuesta en humo
(velocidad). Se pintan con `data-tone`, que redefine los tokens dentro del bloque
(Regla del Bloque Legible): tinta noir en los tres. Es la única rejilla de tarjetas
con color de fondo: fuera de aquí, el bloque pleno no se usa en la app.

### Gráficos
Dos series: cian (`--chart-1`) y lima (`--chart-2`). El verde solo para ventas
ganadas, por significado. Mapa de calor y embudo en tintes de cian. Ejes, leyendas
y rejilla en mono humo. Nunca otro color entre medias.

### Inputs / Fields
- **Style:** fondo Campo, filete #30365a, 0px, texto Tinta. Placeholder #7f8ea1. El
  select lleva su propia flecha y la lista desplegada es opaca (#12141f).
- **Focus:** borde cian + anillo cian de 3px + resplandor corto. Caret lima.
- **Hover:** borde sube a Filete Fuerte.
- **Error / Disabled:** error en Rojo Neón; disabled al 60 % con `not-allowed`.
- **Segmentado:** contenedor Campo; el segmento activo es Capa 2.

### Navigation
- **Style:** barra lateral de 226px en Panel, con filete a la derecha; grupos con
  Overline; ítem = icono de línea (18px, trazo 1.75) + etiqueta 14px/500, 0px.
- **States:** default humo; hover Tinta + Capa; **activo** = lima pleno con Tinta
  Noir y peso 600. La insignia sobre el activo se invierte (noir con texto lima).
- **Píxeles:** en pantallas de más de 1040px de alto asoman al pie del menú, en
  cian y filete, detrás de todo.
- **Cabecera:** Panel opaco con filete abajo; título en la display; avatar lima con
  Tinta Noir.
- **Móvil:** el menú se pliega y sale como cajón opaco (montado con portal).

### Marca
`components/BrandMark.tsx` e `app/icon.svg`: «DRIONY» en mayúsculas (display 800,
+0.05em) con la «O» como un círculo en tres franjas: cian, lima y humo. La «O» sola
es el favicon. Se lee como «Driony» (`role="img"`). El producto se sigue escribiendo
«Driony» en el texto corrido.

### Píxeles
El único adorno de la marca: un racimo de cuadrados (32px, o 24px en el menú) en
lima y Verde Circuito sobre negro, en tinta y verde sobre lima, y en cian y filete
en el panel. Se dibuja con gradientes CSS (`.lp-pix`, `.lp-hero__demo::after`,
`.lp-cta-band::before`, `.side-nav::after`), sin imagen. Nunca detrás de texto.

### Burbuja de mensaje
El corazón de la bandeja. Saliente = Burbuja Saliente (cian hondo) con texto
blanco, a la derecha; entrante = Panel Alto, a la izquierda; 0px. Estado de
entrega con icono (check, doble check, reloj); leído en lima. Fila de conversación:
avatar con iniciales, vista previa, contador lima con Tinta Noir y chip de espera
que pasa a ámbar a la hora; la fila activa lleva lavado de cian y el marcador lima
de 3px. En el hero de la landing el negocio habla en lima pleno con tinta, la
insignia «IA» es cian con tinta y el registro del CRM marca cada paso en cian.

### Banda y cierre (landing)
Marquesina a todo ancho en lima con letra mono noir en mayúsculas (se pausa al
pasar el cursor y se detiene con `prefers-reduced-motion`). El cierre es la pareja:
lima a sangre con Tinta Noir, botón invertido y los píxeles en tinta arriba a la
derecha.

### Hero (landing)
Dos bloques pegados: el lima con el argumento y el oscuro con tinte Verde
Circuito donde corre la conversación en vivo (chat y registro de lo que hace el
CRM) con los píxeles abajo a la derecha. En el lima: el **rótulo ARM** (un punto
hexagonal, «CRM» tachado en un marco de tinta y «ARM» sellado en tinta con texto
lima y sombra dura cian, seguido de «Agentic Relationship Management» en mono),
el titular condensado con la palabra clave marcada en tinta («venden»), el sub a
40ch, los botones invertidos, las garantías en mono, el distintivo de Meta (ya no
se estira) y, desde 1101px, los **píxeles en tinta y verde** abajo a la derecha.
El bloque oscuro lleva un **lomo vertical** pegado a la costura (mono humo,
«Agentic Relationship Management // Driony // En vivo», solo en escritorio) y la
consola se estrecha un punto (el registro baja a 184px). El sello «ARM» cae con
`lp-stamp` después de que suba el rótulo. La demo se reproduce una vez al cargar
y se repite con «Ver otra vez». El HTML del servidor trae el estado final, así
que sin JS o con movimiento reducido se ve completa.

### Sección «00 // Qué es ARM» (landing)
La primera sección tras la banda define el término en el que se basa el
producto: a la izquierda las letras **ARM** gigantes (display 800, condensada,
hasta 12rem, lima con sombra dura cian) y debajo «Agentic // Relationship //
Management» en mono cian; a la derecha la etiqueta «[ 00 // Qué es ARM ]», el h2
(«Un CRM guarda lo que pasó con el cliente. Un ARM pone agentes a atenderlo.») y
el lede. Debajo, las tres claves **A · Agentes, R · Relación, M · Mando** en una
fila separada por filetes (sin tarjetas): la letra grande en lima, el título
condensado y el texto en Tinta tenue a 34ch. En columna (≤900px) se apilan con
filete arriba. El «00» es deliberado: es la definición, no un paso más de la
secuencia 01–06. ARM aparece además en el nav («Qué es ARM»), la banda, la
cabecera de la comparativa («ARM con Driony»), la primera pregunta del FAQ, el
pie (bajo la marca, en mono) y los metadatos de la portada.

### Tiles de capacidades (landing)
Rejilla de seis columnas con tiles biseladas numeradas por CSS (`counter`,
«[ + ] 01, 02…»), como en la referencia. La primera es lima pleno con la captura
del producto y chips en tinta; el resto, Capa 1 con filete. Los h3 van
condensados en mayúsculas. Las tiles 02 y 03 son el **copiloto** en sus dos
caras: en el chat (`.lp-suggest`: la respuesta sugerida sobre fondo negro, las
acciones pendientes como chips y los botones mono Enviar/Editar/Descartar, el
primero en lima) y para quien administra (`.lp-trace--qa`: una pregunta con
marca «TÚ» y la respuesta con marca «IA» en cian).

### Planes (landing)
La sección 06 responde al «cobro por conversación» de la competencia sin
nombrarla. Arriba de las tarjetas, tres celdas con filete (`.lp-pay`): «Pagas»
en lima pleno con la cifra en condensada mayúscula, «No pagas» y «Aparte, y no
pasa por Driony» en Capa 1, con rótulo mono cian. Debajo de las tarjetas, el
selector «Cuál me toca» (`.lp-picker`): formulario a la izquierda (rangos con
`accent-color` lima y salida mono en lima) y resultado a la derecha en lima con
bisel `--cut-md`, nombre del plan en condensada, precio en mono y hechos con
prefijo `//`. El plan sale de `PLANS`: el bloque enseña que sumar gente no mueve
la cifra, nunca una promesa escrita a mano.

### Kit HUD (landing y panel)
Los elementos de la referencia de Stitch, pedidos por el usuario, encima de los
bloques lima (nunca en su lugar):
- **Biseles** (`--cut-sm/md/lg`: esquinas cortadas arriba a la izquierda y abajo
  a la derecha, 6/12/18px) en botones, campos, chips, tarjetas y consolas.
- **Puntos hexagonales** (`--hex`) como indicador: arriba a la derecha de cada
  panel (lima, cian en los pares y dentro de los bloques lima), al lado de la
  etiqueta de sección, en la banda y latiendo en la consola del hero.
- **Crucetas «[ + ]»** en mono humo (`--hud` #6a7d96) arriba a la izquierda de
  cada panel; en los bloques lima, en tinta.
- **Etiquetas de sección** `.lp-tag` («[ 02 // Capacidades ] >>>») en mono cian
  con «>>>» en lima, encima de cada h2 de la landing. Es la única excepción a la
  regla del eyebrow, porque es parte del estilo elegido.
- **Primario con franja de peligro y sombra dura en cian**: el botón es
  transparente y dibuja su cara (`::after`, con la franja de rayas a la
  izquierda) y su sombra (`::before`, desplazada 4px, cian) con
  pseudoelementos biselados, porque un `clip-path` en el propio botón se comería
  la sombra. Dentro de un bloque lima la cara es tinta y la franja lima.
- **Consola de comparación**: el antes/después va en un panel biselado grande
  con cabeceras mono, «X» rojo para lo manual y «>» lima para Driony.
- **Rejilla de telemetría** en el fondo de la landing (puntos cian cada 28px y
  malla cada 56px) y líneas de barrido sobre la demo del hero.
- En el panel: cruceta en las tarjetas y punto hexagonal en tarjetas y KPI
  (abajo a la derecha, porque el bisel corta la esquina de arriba).

El auditor de contraste del scratchpad no ve las caras dibujadas con
pseudoelementos y marca el primario como «lima sobre lima»: es un falso
positivo; el texto va sobre la cara (17:1).

## 6. Do's and Don'ts

### Do:
- **Do** usar lima (#e2f80d) para acción, foco y selección, siempre con Tinta Noir encima.
- **Do** usar cian para datos, presencia y lo que la IA hace, y humo para el texto secundario.
- **Do** redefinir los tokens dentro de un bloque de color y medir el contraste (Regla del
  Bloque Legible).
- **Do** pasar los colores que elige el usuario por `readableInk()`.
- **Do** reservar el verde (#25d366 / #7ee2a8) a lo que es WhatsApp y a los estados positivos.
- **Do** comunicar todo estado con color **+** icono o palabra.
- **Do** separar por filete; sombra corta y dura solo en lo que flota.
- **Do** montar con portal cualquier cosa `position: fixed` que nazca dentro de un elemento con
  `clip-path` u `overflow`.
- **Do** dar respuesta táctil: hover que aviva, `:active` que hunde 1px, contorno de foco lima.
- **Do** titular con Bricolage, trabajar con Hanken y medir con JetBrains Mono (mayúsculas,
  tracking 0.06–0.12em).
- **Do** texto de cuerpo a ≥4.5:1; placeholders a #7f8ea1, nunca gris fantasma.
- **Do** usar iconos SVG de línea (18px, trazo 1.75); los emojis solo dentro de los mensajes.
- **Do** respetar `prefers-reduced-motion`: toda animación tiene alternativa.
- **Do** mover con el scroll desde CSS (`animation-timeline: view()` / `scroll()`) y dejar el
  observador de JS solo como respaldo: el hilo de progreso lima bajo la barra, la captura del hero
  que sube un poco más despacio y los reveals. Nunca librerías de scroll suave.
- **Do** ASCII con mensaje, no de adorno: el terminal del hero narra lo que hace el agente, en
  mono cian sobre Panel, con el fotograma quieto cuando el lector prefiere menos movimiento.
  Las piezas se copian al repo (`asciiAgentLog.ts`, formato de ascii.rest), nada desde un CDN.

### Don't:
- **Don't** caer en **SaaS genérico de plantilla**: rejillas de tarjetas idénticas o todo gris.
  La fila de KPI con color es la excepción y no se copia a otras pantallas.
- **Don't** volverlo **colorido/infantil**: arcoíris de colores ni emojis por todos lados.
- **Don't** parecer **corporativo frío/anticuado**: azules rígidos ni tablas de los 2000.
- **Don't** usar lima translúcido por encima del 8 % ni en estados desactivados: sobre oscuro
  es oliva.
- **Don't** escribir en lima ni en cian sobre humo, ni en blanco sobre lima o cian.
- **Don't** usar cristal (`backdrop-filter`) ni sombras difusas en ninguna superficie.
- **Don't** redondear nada: 0px es la regla; los círculos solo en avatares y puntos de estado.
- **Don't** usar degradado en el texto de titulares ni en la marca.
- **Don't** repetir eyebrows en mayúsculas sobre cada sección de la landing; la mono vive en
  botones, nav, rótulos de tile y banda.
- **Don't** usar `border-left`/`border-right` mayor de 1px como raya decorativa. Las únicas
  son el marcador de la fila activa de la bandeja y la cita dentro de una burbuja.
- **Don't** usar el verde en botones primarios, titulares o adornos, ni el cian para actuar.
- **Don't** animar propiedades de layout salvo el pliegue del menú; las transiciones son de
  120–250 ms y comunican estado, no decoran.
