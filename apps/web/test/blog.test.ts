/**
 * El blog: cómo se lee la cabecera de una entrada, qué se rechaza y con qué
 * aviso, el orden y las series, el video, la dirección pública del sitio y, al
 * final, que todas las entradas que hay en `content/blog` se puedan publicar.
 *
 *   npm run test:blog --workspace=apps/web
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { durationLabel, formatDate, parsePost, PostError, readingMinutes, slugify, splitFrontmatter, type Post } from "../src/features/blog/frontmatter";
import { headings, relatedPosts, seriesOf, showDrafts, sortPosts, tutorialSeries } from "../src/features/blog/posts";
import { clock, isoDuration, parseVideo, youtubeId } from "../src/features/blog/video";
import { DOCS } from "../src/features/docs/registry";
import { absoluteUrl, siteUrl } from "../src/lib/site";

const WEB = path.join(__dirname, "..");

const TUTORIAL = `---
title: Copilot o Autopilot: quién responde
description: En cada chat: Off, Copilot o Autopilot.
date: 2026-11-27
kind: tutorial
series: Agentes de IA
episode: 5
video: https://youtu.be/dQw4w9WgXcQ
duration: 1:04
cover: /blog/copilot-o-autopilot/portada.webp
tags: [agentes de IA, "ventas, sin rodeos", bandeja]
docs: /docs/bandeja#copilot-y-autopilot
---

En cada chat tú decides quién responde.
`;

/** Los problemas que da un archivo, o [] si se puede publicar. */
function problems(file: string, source: string): string[] {
  try {
    parsePost(file, source);
    return [];
  } catch (e) {
    assert.ok(e instanceof PostError, String(e));
    return e.problems;
  }
}

const post = (over: Partial<Post> & { slug: string }): Post => ({
  title: over.slug,
  description: "d",
  date: "2026-11-27",
  updated: null,
  kind: "articulo",
  series: null,
  episode: null,
  video: null,
  duration: null,
  captions: null,
  cover: null,
  coverAlt: null,
  tags: [],
  docs: null,
  author: "Equipo Driony",
  draft: false,
  body: "",
  readingMinutes: 1,
  ...over,
});

test("la cabecera de un tutorial se lee entera", () => {
  const p = parsePost("copilot-o-autopilot.md", TUTORIAL);
  assert.equal(p.slug, "copilot-o-autopilot");
  assert.equal(p.title, "Copilot o Autopilot: quién responde", "los dos puntos del título no cortan el valor");
  assert.equal(p.description, "En cada chat: Off, Copilot o Autopilot.");
  assert.equal(p.kind, "tutorial");
  assert.equal(p.series, "Agentes de IA");
  assert.equal(p.episode, 5);
  assert.equal(p.duration, 64, "1:04 son 64 segundos");
  assert.deepEqual(p.tags, ["agentes de IA", "ventas, sin rodeos", "bandeja"], "una coma entre comillas no separa");
  assert.equal(p.docs, "/docs/bandeja#copilot-y-autopilot");
  assert.equal(p.author, "Equipo Driony");
  assert.equal(p.draft, false);
  assert.equal(p.body, "En cada chat tú decides quién responde.");
});

test("lo mínimo de un artículo: título, descripción, fecha y texto", () => {
  const p = parsePost("hola.md", "---\ntitle: Hola\ndescription: Una prueba.\ndate: 2026-12-01\n---\nTexto.");
  assert.equal(p.kind, "articulo");
  assert.equal(p.video, null);
  assert.deepEqual(p.tags, []);
});

test("un archivo guardado en Windows (CRLF, con BOM) se lee igual", () => {
  const p = parsePost("hola.md", "﻿" + "---\ntitle: \"[Guía] Hola\"\ndescription: 'Una prueba'\ndate: 2026-12-01\ndraft: true\n# una nota para quien escribe\n---\nTexto.\n".replace(/\n/g, "\r\n"));
  assert.equal(p.title, "[Guía] Hola", "entre comillas, un corchete no abre una lista");
  assert.equal(p.description, "Una prueba");
  assert.equal(p.draft, true);
  assert.equal(p.body, "Texto.");
});

test("lo que falta o está mal se dice todo de una vez, con el archivo", () => {
  const bad = `---
titulo: Con la clave en español
date: 27-11-2026
kind: video
episode: 2
video: https://vimeo.com/123
duration: largo
cover: portada
docs: https://driony.com/docs
draft: quizá
sin dos puntos
---
`;
  const found = problems("Mi Entrada.md", bad);
  const has = (re: RegExp) => assert.ok(found.some((p) => re.test(p)), `falta el aviso ${re} en:\n${found.join("\n")}`);
  has(/nombre del archivo.*«mi-entrada\.md»/);
  has(/«titulo» no es un dato de la cabecera/);
  has(/falta «title»/);
  has(/falta «description»/);
  has(/date: «27-11-2026» no es una fecha/);
  has(/kind: pon «articulo» o «tutorial»/);
  has(/episode: falta «series»/);
  has(/video: pon el enlace de YouTube/);
  has(/duration: lo que dura el video/);
  has(/cover: la dirección de una imagen/);
  has(/docs: una página de la documentación/);
  has(/draft: pon true o false/);
  has(/«sin dos puntos» no es «clave: valor»/);
  has(/la entrada está vacía/);
  try {
    parsePost("Mi Entrada.md", bad);
  } catch (e) {
    assert.match((e as Error).message, /^content\/blog\/Mi Entrada\.md no se puede publicar:/);
  }
});

test("otras cabeceras que no pasan", () => {
  const base = "title: T\ndescription: D\ndate: 2026-11-27\n";
  assert.match(problems("a.md", "Sin cabecera")[0]!, /falta la cabecera/);
  assert.match(problems("a.md", `---\n${base}`)[0]!, /la cabecera no se cierra/);
  assert.match(problems("tutoriales.md", `---\n${base}---\nx`)[0]!, /ya es una página del blog/);
  assert.match(problems("a.md", `---\n${base}date: 2026-12-01\n---\nx`)[0]!, /«date» está dos veces/);
  assert.match(problems("a.md", `---\n${base}series: Bandeja\n---\nx`)[0]!, /series y episode son para los tutoriales/);
  assert.match(problems("a.md", `---\n${base}date2: x\n---\nx`)[0]!, /«date2» no es un dato/);
  assert.match(problems("a.md", `---\ntitle: T\ndescription: D\ndate: 2026-02-30\n---\nx`)[0]!, /no es una fecha/);
  assert.match(problems("a.md", `---\n${base}updated: 2026-11-01\n---\nx`)[0]!, /updated: no puede ser anterior/);
  assert.match(problems("a.md", `---\n${base}tags: [a, b\n---\nx`)[0]!, /falta el corchete de cierre/);
  assert.match(problems("a.md", `---\n${base}video: https://youtu.be/dQw4w9WgXcQ\ncaptions: /blog/a/sub.vtt\n---\n`)[0]!, /captions: solo vale con un archivo de video/);
  // Un tutorial puede ser solo su video, sin texto.
  assert.deepEqual(problems("a.md", `---\n${base}kind: tutorial\nvideo: https://youtu.be/dQw4w9WgXcQ\n---\n`), []);
  assert.deepEqual(problems("a.md", `---\n${base}video: https://cdn.driony.com/v/a.mp4\ncaptions: /blog/a/sub.vtt\n---\n`), []);
});

test("la cabecera se separa del texto, y el texto puede llevar sus propias líneas ---", () => {
  const { data, body, problems: found } = splitFrontmatter("---\ntitle: T\nepisode: 3\ndraft: false\ntags: [a, b]\n---\nUno\n\n---\n\nDos\n");
  assert.deepEqual(found, []);
  assert.deepEqual(data, { title: "T", episode: 3, draft: false, tags: ["a", "b"] });
  assert.equal(body, "Uno\n\n---\n\nDos\n");
});

test("enlaces de YouTube en todas sus formas, y los archivos de video", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.equal(youtubeId(url), "dQw4w9WgXcQ", url);
  }
  for (const url of ["https://youtu.be/corto", "https://vimeo.com/123456789", "https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ", "youtu.be/dQw4w9WgXcQ", "javascript:alert(1)"]) {
    assert.equal(youtubeId(url), null, url);
  }
  assert.deepEqual(parseVideo("https://youtu.be/dQw4w9WgXcQ"), { type: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseVideo("/blog/a/video.mp4"), { type: "file", src: "/blog/a/video.mp4" });
  assert.deepEqual(parseVideo("https://cdn.driony.com/a.webm?v=2"), { type: "file", src: "https://cdn.driony.com/a.webm?v=2" });
  assert.equal(parseVideo("http://cdn.driony.com/a.mp4"), null, "un archivo, solo por https");
  assert.equal(parseVideo("//evil.io/a.mp4"), null);
  assert.equal(parseVideo(""), null);
  assert.equal(parseVideo(null), null);
});

test("duraciones y fechas, dichas para una persona y para un buscador", () => {
  assert.equal(clock(64), "1:04");
  assert.equal(clock(37), "0:37");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(isoDuration(64), "PT1M4S");
  assert.equal(isoDuration(120), "PT2M");
  assert.equal(isoDuration(3600), "PT1H");
  assert.equal(isoDuration(0), "PT0S");
  assert.equal(durationLabel(37), "37 s");
  assert.equal(durationLabel(64), "1 min");
  assert.equal(durationLabel(150), "3 min");
  assert.equal(formatDate("2026-11-27"), "27 de noviembre de 2026");
  assert.equal(formatDate("2027-01-05"), "5 de enero de 2027");
  assert.equal(readingMinutes("palabra ".repeat(900)), 5);
  assert.equal(readingMinutes("Corto."), 1);
  assert.equal(slugify("  Revisión de chats: ¿y ahora qué?  "), "revision-de-chats-y-ahora-que");
});

test("el orden: lo más nuevo primero; el mismo día, artículos antes y tutoriales por serie y episodio", () => {
  const sorted = sortPosts([
    post({ slug: "b2", kind: "tutorial", series: "Bandeja", episode: 2 }),
    post({ slug: "viejo", date: "2026-10-01" }),
    post({ slug: "a1", kind: "tutorial", series: "Agentes", episode: 1 }),
    post({ slug: "articulo" }),
    post({ slug: "b1", kind: "tutorial", series: "Bandeja", episode: 1 }),
    post({ slug: "nuevo", kind: "tutorial", date: "2026-12-01" }),
  ]);
  assert.deepEqual(
    sorted.map((p) => p.slug),
    ["nuevo", "articulo", "a1", "b1", "b2", "viejo"],
  );
});

test("las series: cada una por episodio, primero la que tiene lo más nuevo, los sueltos al final", () => {
  const posts = [
    post({ slug: "suelto", kind: "tutorial", date: "2026-12-20" }),
    post({ slug: "a2", kind: "tutorial", series: "Agentes de IA", episode: 2, video: "https://youtu.be/dQw4w9WgXcQ", duration: 50 }),
    post({ slug: "a1", kind: "tutorial", series: "Agentes de IA", episode: 1, video: "https://youtu.be/dQw4w9WgXcQ", duration: 64 }),
    post({ slug: "b1", kind: "tutorial", series: "La bandeja", episode: 1, date: "2026-12-05", duration: 36 }),
    post({ slug: "articulo" }),
  ];
  const series = tutorialSeries(posts);
  assert.deepEqual(
    series.map((s) => [s.name, s.slug, s.posts.map((p) => p.slug), s.seconds]),
    [
      ["La bandeja", "la-bandeja", ["b1"], 0], // sin video todavía: su duración no cuenta
      ["Agentes de IA", "agentes-de-ia", ["a1", "a2"], 114],
      [null, "otros", ["suelto"], 0],
    ],
  );
  const a1 = seriesOf(posts[2]!, posts)!;
  assert.equal(a1.index, 0);
  assert.equal(a1.prev, null);
  assert.equal(a1.next?.slug, "a2");
  assert.equal(seriesOf(posts[0]!, posts), null, "un tutorial suelto no tiene vecinos");
  assert.equal(seriesOf(posts[4]!, posts), null);
});

test("para seguir leyendo: primero lo que comparte temas, nunca la misma serie", () => {
  const posts = [
    post({ slug: "yo", kind: "tutorial", series: "S", episode: 1, tags: ["bandeja", "equipo"] }),
    post({ slug: "misma-serie", kind: "tutorial", series: "S", episode: 2, tags: ["bandeja", "equipo"] }),
    post({ slug: "otro-tipo", tags: [] }),
    post({ slug: "mismo-tipo", kind: "tutorial", series: "T", episode: 1 }),
    post({ slug: "mismo-tema", tags: ["equipo"] }),
  ];
  assert.deepEqual(
    relatedPosts(posts[0]!, 3, posts).map((p) => p.slug),
    ["mismo-tema", "mismo-tipo", "otro-tipo"],
  );
});

test("el índice de un artículo sale de sus títulos de sección", () => {
  const md = "Intro\n\n## Qué **cambia** en `2026`\n\n### Detalle\n\n```md\n## Esto es código\n```\n\n## [Precios](/precios) por país ##\n";
  assert.deepEqual(headings(md), [
    { id: "que-cambia-en-2026", text: "Qué cambia en 2026" },
    { id: "precios-por-pais", text: "Precios por país" },
  ]);
});

test("los borradores solo se ven en local, o pidiéndolo", () => {
  assert.equal(showDrafts({ NODE_ENV: "production" }), false);
  assert.equal(showDrafts({ NODE_ENV: "development" }), true);
  assert.equal(showDrafts({ NODE_ENV: "development", BLOG_DRAFTS: "0" }), false);
  assert.equal(showDrafts({ NODE_ENV: "production", BLOG_DRAFTS: "1" }), true);
});

test("la dirección pública sale de lo que ya está configurado", () => {
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://www.driony.com/", SAAS_BASE_DOMAIN: "driony.com" }), "https://www.driony.com");
  assert.equal(siteUrl({ SAAS_BASE_DOMAIN: "driony.com", AUTH_URL: "https://otra.com" }), "https://driony.com");
  assert.equal(siteUrl({ SAAS_BASE_DOMAIN: "localhost:3000" }), "http://localhost:3000");
  assert.equal(siteUrl({ AUTH_URL: "https://crm.miempresa.com/" }), "https://crm.miempresa.com");
  assert.equal(siteUrl({}), "http://localhost:3000");
  assert.equal(absoluteUrl("/blog/x", "https://driony.com"), "https://driony.com/blog/x");
  assert.equal(absoluteUrl("https://i.ytimg.com/a.jpg", "https://driony.com"), "https://i.ytimg.com/a.jpg");
});

// ── Las entradas que hay de verdad ──

const DIR = path.join(WEB, "content", "blog");
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_")) : [];
const real = files.map((f) => parsePost(f, fs.readFileSync(path.join(DIR, f), "utf8")));

/** Las anclas de una guía de la documentación, como las pone la página. */
function docAnchors(file: string): Set<string> {
  const md = fs.readFileSync(path.join(WEB, "content", "docs", file), "utf8");
  const anchor = (t: string) =>
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  return new Set([...md.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((m) => anchor(m[1]!.replace(/[*_`]/g, ""))));
}

test("todas las entradas de content/blog se pueden publicar", () => {
  // parsePost ya lanzó si alguna cabecera estaba mal; aquí, lo que depende de otros archivos.
  for (const p of real) {
    if (p.cover?.startsWith("/")) assert.ok(fs.existsSync(path.join(WEB, "public", p.cover)), `${p.slug}: no existe la portada ${p.cover} en public/`);
    if (p.captions?.startsWith("/")) assert.ok(fs.existsSync(path.join(WEB, "public", p.captions)), `${p.slug}: no existen los subtítulos ${p.captions}`);
    if (p.cover) assert.ok(p.coverAlt, `${p.slug}: la portada no dice qué se ve (coverAlt)`);
    if (p.docs) {
      const [page, hash] = p.docs.replace(/^\/docs\/?/, "").split("#");
      const doc = DOCS.find((d) => d.slug === page);
      assert.ok(!page || doc, `${p.slug}: «${p.docs}» no es una guía de la documentación`);
      if (doc && hash) assert.ok(docAnchors(doc.file).has(hash), `${p.slug}: la guía ${page} no tiene la sección #${hash}`);
    }
    // Las imágenes del texto que viven en el sitio tienen que existir.
    for (const m of p.body.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)/g)) {
      assert.ok(fs.existsSync(path.join(WEB, "public", m[1]!)), `${p.slug}: no existe la imagen ${m[1]}`);
    }
  }
});

test("en cada serie los episodios van numerados, sin huecos ni repetidos", () => {
  for (const s of tutorialSeries(real)) {
    if (!s.name) continue;
    assert.deepEqual(
      s.posts.map((p) => p.episode),
      s.posts.map((_, i) => i + 1),
      `la serie «${s.name}» tiene los episodios ${s.posts.map((p) => p.episode).join(", ")}`,
    );
  }
});

test("dos entradas no comparten título", () => {
  const titles = real.map((p) => p.title.toLowerCase());
  assert.deepEqual(titles.filter((t, i) => titles.indexOf(t) !== i), []);
});
