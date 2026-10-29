---
name: Driony
description: CRM para WhatsApp con agentes IA — la sala de control del vendedor, edición nocturna
colors:
  violet: "#8a2be2"
  violet-bright: "#b26bff"
  violet-text: "#d6b8ff"
  violet-deep: "#7a1fd6"
  violet-hot: "#9a44f2"
  violet-shadow: "#6614bd"
  violet-soft: "#8a2be229"
  violet-ink: "#ffffff"
  whatsapp: "#25d366"
  positive: "#7ee2a8"
  positive-soft: "#7ee2a824"
  warning: "#e0a458"
  warning-soft: "#e0a45824"
  danger: "#e08a8a"
  danger-soft: "#e08a8a24"
  bg: "#07060c"
  panel: "#140e229e"
  panel-deep: "#0c0816d6"
  sidebar: "#0805108c"
  field: "#04020a80"
  surface: "#ffffff0b"
  surface-2: "#ffffff13"
  surface-3: "#b2a0dc24"
  border: "#b2a0dc29"
  border-strong: "#b2a0dc4d"
  ink: "#f1ecfb"
  muted: "#a49bbd"
  placeholder: "#6f6690"
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
    fontFamily: "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  overline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
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
    backgroundColor: "{colors.violet}"
    textColor: "{colors.violet-ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.violet-hot}"
    textColor: "{colors.violet-ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-soft:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.violet-text}"
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
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "9px 12px"
  segmented:
    backgroundColor: "{colors.field}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "3px"
  bubble-out:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "9px 12px"
  bubble-in:
    backgroundColor: "{colors.surface-2}"
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

**Creative North Star: "La Sala de Control, edición nocturna"**

Driony sigue siendo el puesto de mando del vendedor: una sala a oscuras donde
toda la operación —conversaciones en vivo, oportunidades, campañas— está a la
vista y bajo control. Lo que cambia en esta edición es la materia de la sala. El
fondo es un negro con tinte violeta (#07060c) sobre el que respiran tres brillos
de color (violeta arriba a la izquierda, lila a la derecha, magenta al pie) y una
rejilla técnica fina que asoma en la esquina y se desvanece. Los paneles ya no
son placas opacas: son **cristal**. Dejan pasar el brillo del fondo y, cuando
flotan sobre contenido que se mueve (menú, cabecera, cajones, diálogos), lo
desenfocan. Las tarjetas son translúcidas pero nunca desenfocan; el cristal es
estructural, no decorativo.

La luz de esta sala es el **Violeta Eléctrico** (#8a2be2): el único acento de
marca. Señala acción (botón primario con halo), foco (anillo y resplandor de los
campos), selección (ítem activo del menú, fila activa de la bandeja) y la voz del
negocio en el chat (burbuja saliente). El **Verde WhatsApp** (#25d366) no
compite: queda reservado a lo que *es* WhatsApp (número conectado, «en vivo») y
a los estados positivos (entregado, ganado, opt-in). Dos colores, dos oficios,
nunca intercambiables.

El sistema es **denso pero legible**: muchos hilos, tarjetas y métricas a la vez,
empaquetados con jerarquía y aire suficiente. La energía viene del movimiento
táctil (hover que aviva, pulsación que hunde, entradas cortas) y de los halos con
sentido, no de más color. Rechaza explícitamente el **SaaS genérico de plantilla**
(tarjetas clonadas, gris plano, «big number + label»), lo **colorido/infantil**
(arcoíris y emojis por doquier) y lo **corporativo frío/anticuado** (azules
rígidos, tablas de los 2000). Si una pantalla pudiera ser de cualquier otro
SaaS, falló.

**Key Characteristics:**
- Negro violáceo con brillos de fondo; los paneles son cristal que deja pasar la luz.
- Un solo acento de marca, el Violeta Eléctrico, con halo solo donde hay acción.
- El verde es señal de WhatsApp y de estado positivo, nunca decoración.
- Densidad con jerarquía; aire que respira, nunca apretado.
- Dos familias con oficios separados: Space Grotesk titula, Inter trabaja.
- Estados siempre explícitos (color + icono o palabra), nunca solo color.

## 2. Colors

Negro violáceo como escenario, un violeta como única voz de marca y un verde que
solo habla cuando algo es WhatsApp o salió bien.

### Primary
- **Violeta Eléctrico** (#8a2be2): el acento de marca. Botón primario (en
  degradado hacia Violeta Caliente), foco de campos, ítem de navegación activo,
  fila activa de la bandeja, marca «T», punto de «en tiempo real» del embudo.
- **Violeta Caliente** (#9a44f2) y **Violeta Profundo** (#7a1fd6): las dos paradas
  del degradado del botón primario, de la banda de la landing y de la marca. Nunca
  como colores planos sueltos.
- **Lila** (#b26bff): la luz del violeta. Segunda parada de los degradados de
  brillo, barra del ítem activo, líneas luminosas. Texto en el registro de marca
  (etiqueta de sección de la landing).
- **Violeta Texto** (#d6b8ff): el violeta legible como texto sobre fondo oscuro
  (enlaces, chips suaves, botón suave). Es lo que se usa donde el #8a2be2 no daría
  contraste como texto.
- **Violeta Tenue** (#8a2be2 al 16%): fondo de selección y de chips suaves. Tinte,
  no bloque.
- **Tinta sobre Violeta** (#ffffff): el texto que va encima del violeta (botones
  primarios, banda). Sobre el botón blanco de la landing, el texto es **Violeta
  Sombra** (#6614bd).

### Secondary
- **Verde WhatsApp** (#25d366): exclusivo de lo que es WhatsApp: botón «Conectar
  WhatsApp», icono del canal, número conectado, «en vivo». Es herencia, no acento.
- **Verde Vital** (#7ee2a8) y **Verde Tenue** (#7ee2a8 al 14%): estado positivo
  como texto y como chip (entregado, ganado, opt-in sí, conexión activa).

### Tertiary (estados)
- **Ámbar** (#e0a458) y **Ámbar Tenue**: advertencia y pendiente (conversación
  esperando, token por caducar, aviso de límite).
- **Rojo Suave** (#e08a8a) y **Rojo Tenue**: error, perder, opt-out, acciones
  destructivas.

### Neutral
- **Noche** (#07060c): el lienzo. Casi negro con tinte violeta; encima van tres
  brillos radiales (violeta, lila, magenta) y la rejilla de 40px.
- **Cristal** (#140e22 al 62%): tarjetas y paneles. Translúcido: deja pasar el
  brillo del fondo. Lleva una línea de luz de 1px arriba.
- **Cristal Hondo** (#0c0816 al 84%): cajones, diálogos y barras pegajosas; más
  opaco para que el contenido que pasa por debajo no compita, y **con desenfoque**.
- **Barra Lateral** (#080510 al 55%): la navegación, cristal con desenfoque.
- **Campo** (#04020a al 50%): el interior de inputs, selects y textareas; el hueco
  donde se escribe, con sombra interior de 1px.
- **Capa 1 / Capa 2** (blanco al 4,5% / 7,5%): superficies que flotan sobre el
  cristal (burbuja entrante, segmento activo, notas). Cada capa un poco más clara.
- **Capa Lila** (#b2a0dc al 14%): chips y avatares neutros.
- **Borde** (#b2a0dc al 16%) y **Borde Fuerte** (al 30%): hairline para estructura;
  el fuerte solo en hover y foco.
- **Tinta** (#f1ecfb): texto principal.
- **Tinta Apagada** (#a49bbd): texto secundario, etiquetas, metadatos. Lila-gris,
  no gris muerto.
- **Placeholder** (#6f6690): el mínimo legible dentro de un campo.

### Named Rules
**La Regla del Único Acento.** El Violeta Eléctrico es el único color de marca.
Aparece en ≤15% de cualquier pantalla: acción, foco, selección, voz del negocio.
Si dos cosas violetas compiten por atención, una de las dos no debería ser violeta.

**La Regla del Verde Reservado.** El verde solo dice dos cosas: «esto es WhatsApp»
o «esto salió bien». Jamás en un botón primario, un titular o un adorno.

**La Regla del Estado Doble.** Ningún estado se comunica solo con color. Entregado,
ganado, perdido, pausado: siempre color **+** icono o palabra.

**La Regla de la Transparencia con Fondo.** Los colores translúcidos existen para
dejar pasar el brillo del fondo. Nunca se apilan más de dos capas translúcidas:
la tercera se vuelve barro.

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
**La Regla de las Dos Familias.** Space Grotesk titula, Inter trabaja. Prohibida la
display en botones, etiquetas, campos o datos; prohibida Inter en el h1 del hero.

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
gris. El halo violeta es la excepción luminosa, y solo para acción y foco.

### Shadow Vocabulary
- **Línea de luz** (`inset 0 1px 0 rgba(255,255,255,.06)`): el borde superior de
  todo cristal (tarjetas, cajones, diálogos, ítem activo). Es lo que hace leer la
  superficie como vidrio y no como placa gris.
- **Sombra de tarjeta** (`0 12px 32px -20px rgba(0,0,0,.75)` + línea de luz): tarjetas
  en reposo. Larga y negativa: separa sin gritar.
- **Sombra de overlay** (`0 30px 70px -24px rgba(0,0,0,.8)` + línea de luz): menús,
  popovers, diálogos.
- **Sombra de cajón** (`-24px 0 70px -24px rgba(0,0,0,.8)`): paneles laterales
  (playground, asistente, detalle de oportunidad).
- **Halo de acento** (`0 0 0 1px rgba(138,43,226,.22), 0 10px 28px -10px rgba(138,43,226,.7)`):
  botón primario en reposo; crece en hover. También en el foco de campos
  (`0 0 0 3px` tenue + `0 0 22px -6px`).
- **Desenfoque de cristal** (`backdrop-filter: blur(18px) saturate(160%)`): barra
  lateral, cabecera, cajones, diálogos, menús flotantes, avisos y barras pegajosas.
  Los fondos de modal desenfocan la página con `blur(6px)`.

### Named Rules
**La Regla del Cristal Estructural.** Solo desenfoca lo que flota sobre contenido
que se mueve: menú, cabecera, cajones, diálogos, menús, avisos. Las tarjetas son
translúcidas pero **nunca** llevan `backdrop-filter`: además de ser decoración, un
desenfoque convierte a la tarjeta en contenedor de sus modales `position: fixed` y
los recorta.

**La Regla del Halo con Sentido.** El resplandor violeta solo aparece en la acción
principal, en el foco y en la selección activa. Un halo en algo que no se puede
pulsar miente.

**La Regla Anti Ghost-Card.** Una superficie se separa por transparencia y línea de
luz, o por sombra; nunca por `border: 1px solid` más una sombra ancha compitiendo.
Si una tarjeta lleva borde, su sombra es la larga y negativa de arriba o ninguna.

## 5. Components

Carácter general: **táctil y con luz propia**. Superficies de cristal que
responden al instante: el hover aviva, la pulsación hunde 1px, el foco enciende un
anillo violeta. Sin floritura; una herramienta que responde.

### Buttons
- **Shape:** esquinas suaves (8px, `{rounded.control}`); compacto 7px; en la landing,
  pastilla (999px).
- **Primary:** degradado Violeta Caliente → Violeta Profundo con una luz blanca arriba
  (16%), texto blanco, peso 600, padding 9px 16px, Halo de acento. Hover: degradado
  más claro y halo más largo; `:active` degradado más hondo y sin halo largo.
- **Ghost:** transparente, borde Borde, texto Tinta; hover rellena al 5% y sube el
  borde a Borde Fuerte. Para Cancelar, Editar, acciones secundarias.
- **Soft:** Violeta Tenue con texto Violeta Texto y borde violeta al 35%; hover añade
  un halo corto. Para acciones destacadas que no son la principal (Probar, Asistente).
- **Danger:** transparente con texto y borde rojo; hover tiñe de Rojo Tenue.
- **Focus:** anillo `outline` 2px violeta con offset 2px en todo lo pulsable.
- **Disabled:** 55% de opacidad y cursor `not-allowed`.
- **Landing:** primario en pastilla con degradado y halo; sobre la banda violeta el
  primario se invierte (blanco con texto Violeta Sombra) y el secundario es contorno
  blanco con cristal.

### Chips
- **Style:** pastilla (999px), 11–13px, `inline-flex` con icono de 10px si lo lleva.
  Neutro = Capa Lila con texto Tinta. Positivo = Verde Tenue + Verde Vital.
  Advertencia = Ámbar Tenue + Ámbar. Etiquetas y fuentes = su color propio a tono pleno.
- **State:** filtro seleccionado = Violeta Tenue + borde violeta; no seleccionado =
  transparente + Borde, texto Tinta Apagada.

### Cards / Containers
- **Corner Style:** 12px (`{rounded.surface}`); diálogos 14px.
- **Background:** Cristal (translúcido) sobre Noche. Deja pasar el brillo.
- **Shadow Strategy:** Sombra de tarjeta (línea de luz + sombra larga). Sin
  `backdrop-filter` (Regla del Cristal Estructural).
- **Border:** Borde de 1px hairline.
- **Internal Padding:** 18px (tarjeta) / 16px (paneles compactos).

### Inputs / Fields
- **Style:** fondo Campo (translúcido y más hondo), borde Borde, radio 8px, texto Tinta,
  sombra interior de 1px. Placeholder #6f6690. El select lleva su propia flecha
  (chevron lila) y la lista desplegada es opaca (#0d0916).
- **Focus:** borde violeta + anillo tenue de 3px + resplandor corto. Caret violeta.
- **Hover:** borde sube a Borde Fuerte.
- **Error / Disabled:** error en Rojo Suave; disabled al 60% con `not-allowed`.
- **Segmentado:** contenedor Campo con sombra interior; el segmento activo es Capa 2
  con línea de luz.

### Navigation
- **Style:** barra lateral fija de 226px en cristal desenfocado, con línea sutil en su
  borde derecho; grupos con Overline; ítem = icono de línea (18px, trazo 1.75) + etiqueta
  14px/500, radio 12px. Marca: cuadrado con degradado violeta → lila y halo; nombre en
  Space Grotesk.
- **States:** default Tinta Apagada; hover Tinta + fondo blanco al 5%; **activo** =
  degradado Violeta Tenue → lila al 5%, texto claro, línea de luz, icono con sombra
  violeta y **barra indicadora de 3px** (violeta → lila, con brillo) pegada al borde
  izquierdo. Es un indicador de selección, la única raya lateral permitida.
- **Cabecera:** cristal desenfocado con una línea de luz violeta → lila que recorre su
  borde inferior; título en Space Grotesk; avatar con degradado violeta.
- **Móvil:** el menú se pliega y sale como cajón de cristal con fondo desenfocado
  (montado con portal); el título deja de mostrar subtítulo.

### Burbuja de mensaje (componente firma)
El corazón de la bandeja. Saliente = degradado violeta al 34% → lila al 14%, a la
derecha; entrante = Capa 2, a la izquierda. Estado de entrega en texto pequeño con
icono (check, doble check, reloj) y en Verde Vital cuando está leído. Acciones
(responder, reaccionar) aparecen al pasar el cursor o al enfocar con teclado.
Fila de conversación: avatar con iniciales, vista previa con icono del tipo de
archivo, contador azul-violeta de no leídos y chip de espera que pasa a ámbar a la
hora; la fila activa lleva el degradado violeta y la barra indicadora.

### Banda violeta (landing)
Franja a todo ancho en degradado Violeta Profundo → Caliente, texto blanco en
Space Grotesk mayúsculas con puntos luminosos, en marquesina lenta (se pausa al
pasar el cursor y se detiene con `prefers-reduced-motion`). La misma materia
cierra la página: sección a pantalla completa, limpia (sin rejilla ni marca de
fondo), con el botón primario invertido.

### Conversación en vivo (hero de la landing)
Una venta de principio a fin en vez de una captura reducida: el chat (burbuja
entrante en Capa 2, saliente en violeta, sello «IA») y al lado el registro de lo
que hace el CRM, con un hilo vertical y el paso actual con halo violeta. Se
reproduce una vez al cargar y se repite con «Ver otra vez». El HTML del servidor
trae el estado final, así que sin JS o con movimiento reducido se ve completa.

## 6. Do's and Don'ts

### Do:
- **Do** usar el Violeta Eléctrico (#8a2be2) solo para acción, foco, selección y la voz
  del negocio; ≤15% de la pantalla (La Regla del Único Acento).
- **Do** reservar el verde (#25d366 / #7ee2a8) a lo que es WhatsApp y a los estados
  positivos (La Regla del Verde Reservado).
- **Do** comunicar todo estado con color **+** icono o palabra (La Regla del Estado Doble).
- **Do** separar superficies con transparencia y línea de luz; desenfocar solo lo
  estructural: menú, cabecera, cajones, diálogos, menús, avisos.
- **Do** montar con portal cualquier cosa `position: fixed` que nazca dentro de un
  elemento con `backdrop-filter`.
- **Do** dar respuesta táctil: hover que aviva, `:active` que hunde 1px, anillo de foco
  violeta por `outline`.
- **Do** titular con Space Grotesk y trabajar con Inter; jerarquía por tamaño y peso.
- **Do** texto de cuerpo a ≥4.5:1 (Tinta #f1ecfb y Tinta Apagada #a49bbd sobre cristal);
  placeholders a #6f6690, nunca gris fantasma.
- **Do** usar iconos SVG de línea (18px, trazo 1.75) para toda señal de interfaz; los
  emojis solo dentro del contenido de los mensajes.
- **Do** respetar `prefers-reduced-motion`: toda animación tiene alternativa de
  crossfade o instantánea.

### Don't:
- **Don't** caer en **SaaS genérico de plantilla**: rejillas de tarjetas idénticas, todo
  gris, el template «big number + label» de dashboard.
- **Don't** volverlo **colorido/infantil**: arcoíris de colores ni emojis por todos lados;
  la energía va por movimiento y el acento, no por ruido.
- **Don't** parecer **corporativo frío/anticuado**: azules corporativos rígidos ni tablas
  densas estilo software de los 2000.
- **Don't** poner `backdrop-filter` en tarjetas ni usar el cristal como decoración
  (La Regla del Cristal Estructural).
- **Don't** usar degradado en el texto de titulares ni en la marca; énfasis por peso,
  tamaño o un color plano (La Regla del Titular Sólido).
- **Don't** repetir eyebrows en mayúsculas sobre cada sección; el overline vive solo en
  los grupos del nav (La Regla del Overline Confinado).
- **Don't** usar `border-left`/`border-right` mayor de 1px como raya decorativa en
  tarjetas, avisos o listas. Las únicas rayas laterales son el indicador de selección
  de 3px del nav y de la fila activa de la bandeja, y la barra de la cita dentro de
  una burbuja del chat (la convención de WhatsApp para «respondiendo a»).
- **Don't** parear `border: 1px solid` con `box-shadow` de blur ≥16px positivo en la
  misma tarjeta o botón (ghost-card); la sombra de tarjeta es larga y negativa o no es.
- **Don't** redondear tarjetas o campos a 24/28/32px+. Techo: 12px en superficies, 14px
  en diálogos; pastilla solo en chips y en los botones de la landing.
- **Don't** usar el verde en botones primarios, titulares o adornos, ni el violeta en
  chips de estado positivo.
- **Don't** apilar más de dos capas translúcidas (La Regla de la Transparencia con
  Fondo).
- **Don't** animar propiedades de layout (`width`, `height`) salvo el pliegue del menú;
  las transiciones son de 120–250 ms y comunican estado, no decoran.
