import { parseVideo } from "./video";

/**
 * Una entrada del blog es un archivo Markdown en `apps/web/content/blog/`. El
 * nombre del archivo es su dirección (`mi-entrada.md` → `/blog/mi-entrada`) y
 * arriba lleva una cabecera entre dos líneas `---`, con un dato por línea
 * (`clave: valor`). Es un subconjunto pequeño de YAML a propósito: texto,
 * números, true/false y listas entre corchetes.
 *
 * Aquí solo hay texto que entra y datos que salen (sin disco), para poder
 * probarlo. Una cabecera mal escrita detiene el build diciendo qué archivo y
 * qué dato: es mejor que publicar una entrada sin fecha o con el video roto.
 */

export const POST_KINDS = ["articulo", "tutorial"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const KIND_LABEL: Record<PostKind, string> = { articulo: "Artículo", tutorial: "Tutorial" };
/** La página que lista cada tipo. */
export const KIND_PATH: Record<PostKind, string> = { articulo: "/blog/articulos", tutorial: "/blog/tutoriales" };
export const DEFAULT_AUTHOR = "Equipo Driony";
/** El RSS, para la cabecera de cada página del blog (cada página define sus `alternates` enteros). */
export const BLOG_FEEDS = { "application/rss+xml": [{ url: "/blog/rss.xml", title: "Blog de Driony" }] };
/** Nombres que un archivo no puede llevar: ya son páginas del blog. */
export const RESERVED_SLUGS = ["tutoriales", "articulos", "rss", "pagina"];

/** Los datos de la cabecera, en el orden en que conviene escribirlos. */
export const POST_KEYS = [
  "title",
  "description",
  "date",
  "updated",
  "kind",
  "series",
  "episode",
  "video",
  "duration",
  "captions",
  "cover",
  "coverAlt",
  "tags",
  "docs",
  "author",
  "draft",
] as const;

export interface PostMeta {
  /** El nombre del archivo sin `.md`: su dirección en `/blog/…`. */
  slug: string;
  title: string;
  /** Una o dos frases: van bajo el título, en el listado y en Google. */
  description: string;
  /** AAAA-MM-DD. */
  date: string;
  updated: string | null;
  kind: PostKind;
  /** Los tutoriales de una misma serie se enseñan juntos, por número de episodio. */
  series: string | null;
  episode: number | null;
  /** Enlace de YouTube o dirección de un .mp4. Sin video, la entrada se lee igual. */
  video: string | null;
  /** Lo que dura el video, en segundos. */
  duration: number | null;
  /** Subtítulos .vtt, solo para un archivo de video. */
  captions: string | null;
  /** Imagen de portada: `/blog/<entrada>/portada.webp` (en `public/`) o una dirección https. */
  cover: string | null;
  coverAlt: string | null;
  tags: string[];
  /** La guía de la documentación que lo cuenta completo, como `/docs/agentes#seguimientos`. */
  docs: string | null;
  author: string;
  /** Un borrador no se publica: solo se ve trabajando en local. */
  draft: boolean;
}

export interface Post extends PostMeta {
  /** El Markdown, sin la cabecera. */
  body: string;
  readingMinutes: number;
}

/** Todo lo que está mal en un archivo, de una vez. */
export class PostError extends Error {
  constructor(
    public readonly file: string,
    public readonly problems: string[],
  ) {
    super(`content/blog/${file} no se puede publicar:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "PostError";
  }
}

type Scalar = string | number | boolean | null;
type Value = Scalar | Scalar[];

/** «Copilot y Autopilot» → «copilot-y-autopilot». Para direcciones y anclas. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scalar(raw: string): Scalar {
  const v = raw.trim();
  if (!v) return null;
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) return v.slice(1, -1);
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Los elementos de una lista `[a, "b, c", d]`: las comas entre comillas no separan. */
function listItems(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Separa la cabecera del contenido y lee sus datos. Lo que no entiende lo dice en `problems`. */
export function splitFrontmatter(source: string): { data: Record<string, Value>; body: string; problems: string[] } {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const data: Record<string, Value> = {};
  const problems: string[] = [];
  if (!/^---[ \t]*\n/.test(text)) {
    return { data, body: text, problems: ["falta la cabecera: el archivo empieza con una línea «---», luego los datos y otra línea «---»"] };
  }
  const rest = text.slice(3);
  const close = /\n---[ \t]*(?:\n|$)/.exec(rest);
  if (!close) return { data, body: "", problems: ["la cabecera no se cierra: falta la segunda línea «---»"] };
  const head = rest.slice(rest.indexOf("\n") + 1, close.index + 1);
  const body = rest.slice(close.index + close[0].length);

  head.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = /^([A-Za-z][\w-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(t);
    if (!m) {
      problems.push(`línea ${i + 2}: «${t}» no es «clave: valor» (con un espacio después de los dos puntos)`);
      return;
    }
    const key = m[1]!;
    if (key in data) {
      problems.push(`«${key}» está dos veces en la cabecera`);
      return;
    }
    const raw = (m[2] ?? "").trim();
    if (raw.startsWith("[")) {
      if (!raw.endsWith("]")) problems.push(`${key}: a la lista le falta el corchete de cierre`);
      else data[key] = listItems(raw.slice(1, -1)).map(scalar);
    } else data[key] = scalar(raw);
  });
  return { data, body, problems };
}

/** ¿Es una fecha AAAA-MM-DD que existe? */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** «1:04» o 64 → 64 segundos; null si no es una duración. */
function seconds(value: Scalar): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m || Number(m[3]) > 59) return null;
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return total > 0 ? total : null;
}

const IMAGE = /\.(webp|png|jpe?g|avif)(\?[^#]*)?$/i;
const local = (v: string) => v.startsWith("/") && !v.startsWith("//");
const localOrHttps = (v: string) => local(v) || /^https:\/\//i.test(v);

/** Minutos de lectura: unas 200 palabras por minuto, sin contar enlaces ni símbolos. */
export function readingMinutes(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(words / 200));
}

/** Lee un archivo del blog. `file` es su nombre (`mi-entrada.md`). Lanza `PostError` con todo lo que falte. */
export function parsePost(file: string, source: string): Post {
  const slug = file.replace(/\.md$/i, "");
  const { data, body, problems } = splitFrontmatter(source);

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    problems.push(`el nombre del archivo es la dirección de la entrada: solo minúsculas, números y guiones (por ejemplo «${slugify(slug) || "mi-entrada"}.md»)`);
  }
  if (RESERVED_SLUGS.includes(slug)) problems.push(`«${slug}» ya es una página del blog: ponle otro nombre al archivo`);
  for (const key of Object.keys(data)) {
    if (!(POST_KEYS as readonly string[]).includes(key)) problems.push(`«${key}» no es un dato de la cabecera. Los que hay: ${POST_KEYS.join(", ")}`);
  }

  const text = (key: (typeof POST_KEYS)[number], max: number): string | null => {
    const v = data[key];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v) || typeof v === "boolean") {
      problems.push(`${key}: tiene que ser un texto`);
      return null;
    }
    const s = String(v).trim();
    if (s.length > max) problems.push(`${key}: es muy largo (${s.length} caracteres; como mucho ${max})`);
    return s || null;
  };
  const required = (key: "title" | "description" | "date", max: number): string => {
    const v = text(key, max);
    if (v === null) problems.push(`falta «${key}»`);
    return v ?? "";
  };

  const title = required("title", 120);
  const description = required("description", 240);
  const date = required("date", 10);
  if (date && !isDate(date)) problems.push(`date: «${date}» no es una fecha; va como AAAA-MM-DD (por ejemplo 2026-11-27)`);
  const updated = text("updated", 10);
  if (updated && !isDate(updated)) problems.push(`updated: «${updated}» no es una fecha; va como AAAA-MM-DD`);
  else if (updated && isDate(date) && updated < date) problems.push("updated: no puede ser anterior a date");

  const rawKind = slugify(text("kind", 20) ?? "articulo");
  const kind = (POST_KINDS as readonly string[]).includes(rawKind) ? (rawKind as PostKind) : null;
  if (!kind) problems.push(`kind: pon «articulo» o «tutorial»`);

  const series = text("series", 60);
  const episodeRaw = data.episode;
  let episode: number | null = null;
  if (episodeRaw !== undefined && episodeRaw !== null) {
    if (typeof episodeRaw === "number" && Number.isInteger(episodeRaw) && episodeRaw >= 1) episode = episodeRaw;
    else problems.push("episode: es el número del episodio dentro de la serie (1, 2, 3…)");
  }
  if (kind === "articulo" && (series || episode !== null)) problems.push("series y episode son para los tutoriales: añade «kind: tutorial»");
  if (episode !== null && !series) problems.push("episode: falta «series», el nombre de la serie a la que pertenece");

  const video = text("video", 300);
  const parsedVideo = parseVideo(video);
  if (video && !parsedVideo) problems.push("video: pon el enlace de YouTube del video o la dirección https de un archivo .mp4");

  let duration: number | null = null;
  if (data.duration !== undefined && data.duration !== null) {
    duration = Array.isArray(data.duration) ? null : seconds(data.duration);
    if (duration === null) problems.push("duration: lo que dura el video, en segundos (64) o como minutos:segundos (1:04)");
  }

  const captions = text("captions", 300);
  if (captions) {
    if (!localOrHttps(captions) || !/\.vtt(\?[^#]*)?$/i.test(captions)) problems.push("captions: la dirección de un archivo de subtítulos .vtt");
    else if (parsedVideo?.type !== "file") problems.push("captions: solo vale con un archivo de video; en YouTube los subtítulos se suben allí");
  }

  const cover = text("cover", 300);
  if (cover && (!localOrHttps(cover) || !IMAGE.test(cover))) {
    problems.push("cover: la dirección de una imagen (.webp, .png o .jpg), como /blog/mi-entrada/portada.webp o una dirección https");
  }
  const coverAlt = text("coverAlt", 200);

  let tags: string[] = [];
  if (data.tags !== undefined && data.tags !== null) {
    const list = Array.isArray(data.tags) ? data.tags : String(data.tags).split(",");
    tags = [...new Set(list.map((t) => String(t ?? "").trim()).filter(Boolean))];
    if (tags.length > 8) problems.push(`tags: son muchas (${tags.length}; como mucho 8)`);
    if (tags.some((t) => t.length > 30)) problems.push("tags: cada etiqueta, de 30 caracteres como mucho");
  }

  const docs = text("docs", 200);
  if (docs && !/^\/docs(\/|#|$)/.test(docs)) problems.push("docs: una página de la documentación, como /docs/agentes#seguimientos");

  const author = text("author", 80) ?? DEFAULT_AUTHOR;
  let draft = false;
  if (data.draft !== undefined && data.draft !== null) {
    if (typeof data.draft === "boolean") draft = data.draft;
    else problems.push("draft: pon true o false");
  }

  const content = body.trim();
  if (!content && !parsedVideo) problems.push("la entrada está vacía: escribe el contenido debajo de la cabecera");

  if (problems.length) throw new PostError(file, problems);
  return {
    slug,
    title,
    description,
    date,
    updated,
    kind: kind!,
    series,
    episode,
    video,
    duration,
    captions,
    cover,
    coverAlt,
    tags,
    docs,
    author,
    draft,
    body: content,
    readingMinutes: readingMinutes(content),
  };
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «2026-11-27» → «27 de noviembre de 2026». Sin zona horaria: la fecha es la que se escribió. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} de ${MONTHS[(m ?? 1) - 1]} de ${y}`;
}

/** Lo que dura, dicho en corto: 37 → «37 s»; 64 → «1 min»; 150 → «3 min». */
export function durationLabel(sec: number): string {
  return sec < 60 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}
