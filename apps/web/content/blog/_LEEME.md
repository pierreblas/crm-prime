# Cómo publicar en el blog

Cada entrada del blog es un archivo `.md` en esta carpeta. No hay índice que mantener: se añade el archivo, se despliega la web y la entrada aparece en `/blog`.

- El **nombre del archivo es su dirección**: `mi-entrada.md` se publica en `/blog/mi-entrada`. Solo minúsculas, números y guiones.
- Los archivos que empiezan por `_` (como este) no se publican.
- Hay dos tipos: **artículo** (`kind: articulo`) y **tutorial** (`kind: tutorial`). Los tutoriales pueden llevar video y agruparse en series.

## 1. La cabecera

Arriba del archivo, entre dos líneas `---`, van los datos de la entrada, uno por línea (`clave: valor`, con un espacio después de los dos puntos).

Un artículo:

```md
---
title: Cómo responder un lead en menos de un minuto
description: Por qué el primer minuto decide la venta y cómo llegar a tiempo sin estar pegado al teléfono.
date: 2026-12-03
kind: articulo
cover: /blog/responder-en-un-minuto/portada.webp
coverAlt: Un chat de WhatsApp respondido a los pocos segundos
tags: [ventas, WhatsApp]
---

Aquí empieza el texto…
```

Un tutorial de una serie, con su video:

```md
---
title: Crea tu agente de IA en cinco preguntas
description: El asistente «Con ayuda» te hace cinco preguntas y redacta las instrucciones de tu agente.
date: 2026-11-27
kind: tutorial
series: Agentes de IA
episode: 1
video: https://youtu.be/XXXXXXXXXXX
duration: 1:04
cover: /blog/crea-tu-agente-de-ia/portada.webp
coverAlt: El asistente de Driony preguntando cuál es la misión del agente
tags: [agentes de IA, primeros pasos]
docs: /docs/agentes#crear-un-agente
---
```

| Dato | Obligatorio | Qué es |
|---|---|---|
| `title` | sí | El título. Hasta 120 caracteres. |
| `description` | sí | Una o dos frases. Salen bajo el título, en el listado y en Google. Hasta 240 caracteres. |
| `date` | sí | La fecha de publicación, como `2026-11-27`. Lo más nuevo sale primero. |
| `kind` | no | `articulo` (si no pones nada) o `tutorial`. |
| `series` | no | Solo tutoriales: el nombre de la serie. Los de la misma serie se enseñan juntos. Escríbelo siempre igual. |
| `episode` | no | Solo tutoriales: el número dentro de la serie (1, 2, 3…). |
| `video` | no | El enlace de YouTube, o la dirección `https` de un archivo `.mp4`. Sin video, la entrada se lee igual. |
| `duration` | no | Lo que dura el video: en segundos (`64`) o como `1:04`. |
| `captions` | no | Subtítulos `.vtt`, solo si el video es un archivo. En YouTube se suben allí. |
| `cover` | no | La imagen de portada. Sin ella sale una portada con la marca. |
| `coverAlt` | no | Qué se ve en la portada, para quien no puede verla. |
| `tags` | no | Hasta 8 temas entre corchetes: `[bandeja, equipo]`. Sirven para proponer «Sigue con esto». |
| `docs` | no | La guía de la documentación que lo cuenta completo, como `/docs/bandeja#el-panel-del-contacto`. |
| `author` | no | Quien firma. Si no pones nada, «Equipo Driony». |
| `updated` | no | La fecha de la última revisión, si cambió después de publicarse. |
| `draft` | no | `true` para un borrador (ver abajo). |

Si un título empieza por comillas o por un corchete, ponlo entero entre comillas: `title: "[Guía] Cómo empezar"`.

## 2. El texto

Debajo de la cabecera va el texto en Markdown. Lo que conviene saber:

- **Secciones** con `## Título`. En un artículo, el índice de la derecha sale de ellas. No hace falta repetir el título de la entrada.
- **Pasos**: una lista numerada (`1.`, `2.`…) sale con cada número en un globo. Úsala para el paso a paso de un tutorial.
- **Una cita** (`> texto`) sale como un globo de conversación: sirve para destacar una idea o una frase de un cliente.
- **Una imagen**, sola en su línea: `![Qué se ve](/blog/mi-entrada/captura.webp "Pie de foto opcional")`.
- **Un video dentro del texto**: el enlace de YouTube, solo en su línea.
- **Tablas**, **negritas** y `código`, como en la documentación.
- Los enlaces a otras páginas de Driony van sin el dominio: `[la bandeja](/docs/bandeja)`.

## 3. Imágenes y videos

- Las imágenes de una entrada van en `apps/web/public/blog/<nombre-de-la-entrada>/`. La portada, de 1280 × 720 y en `.webp` (unas decenas de KB).
- Los **videos no se guardan aquí**: pesan mucho y este repositorio es público. Se suben a YouTube y se pega el enlace en `video`. El reproductor de YouTube no se carga hasta que el visitante pulsa reproducir.

## 4. Borradores

Con `draft: true` la entrada no se publica: solo se ve trabajando en local (`npm run dev`), con la marca «Borrador». Para revisarla en un build, `BLOG_DRAFTS=1`.

Ojo: el archivo sigue estando en el repositorio, que es público. No escribas en un borrador nada que no pueda leerse.

## 5. Publicar

1. Comprueba las entradas: `npm run test:blog --workspace=apps/web`. Revisa que cada cabecera esté completa, que las portadas existan y que los enlaces a la documentación lleven a una sección que existe.
2. Confirma el archivo (y sus imágenes) y despliega la web. Las páginas del blog se escriben en el build.

Si a una cabecera le falta algo, el build se detiene y dice en qué archivo y qué dato: es mejor que publicar una entrada sin fecha o con el video roto.

Con cada entrada publicada se actualizan solos el listado, las series, el RSS (`/blog/rss.xml`) y el mapa del sitio (`/sitemap.xml`).
