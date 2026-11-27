import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parsePost, slugify, type Post, type PostKind } from "./frontmatter";

/**
 * Las entradas del blog, leídas de `apps/web/content/blog/*.md`. Publicar es
 * añadir un archivo: no hay índice que mantener. Las páginas se escriben en el
 * build (como la documentación), así que en producción no se lee el disco.
 *
 * Los archivos que empiezan por `_` (la guía `_LEEME.md`) no son entradas.
 */

const DIR = path.join(process.cwd(), "content", "blog");

/** Los borradores solo se ven trabajando en local, o con BLOG_DRAFTS=1 para revisarlos en un build. */
export function showDrafts(env: Record<string, string | undefined> = process.env): boolean {
  return env.BLOG_DRAFTS === "1" || (env.NODE_ENV === "development" && env.BLOG_DRAFTS !== "0");
}

/**
 * El orden del blog: lo más nuevo primero. En la misma fecha, los artículos
 * antes que los tutoriales, y los tutoriales por serie y episodio.
 */
export function sortPosts(posts: Post[]): Post[] {
  return [...posts].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.kind === b.kind ? 0 : a.kind === "articulo" ? -1 : 1) ||
      (a.series ?? "").localeCompare(b.series ?? "", "es") ||
      (a.episode ?? 0) - (b.episode ?? 0) ||
      a.title.localeCompare(b.title, "es"),
  );
}

function readAll(): Post[] {
  if (!existsSync(DIR)) return [];
  const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".md") && !f.startsWith("_"));
  const posts = files.map((f) => parsePost(f, readFileSync(path.join(DIR, f), "utf8")));
  const drafts = showDrafts();
  return sortPosts(posts.filter((p) => drafts || !p.draft));
}

let cache: Post[] | null = null;

/** Las entradas que se publican, ordenadas. */
export function allPosts(): Post[] {
  // En desarrollo se relee cada vez: así un archivo nuevo aparece al recargar.
  if (process.env.NODE_ENV === "development") return readAll();
  return (cache ??= readAll());
}

export function findPost(slug: string): Post | undefined {
  return allPosts().find((p) => p.slug === slug);
}

export function postsOfKind(kind: PostKind, posts = allPosts()): Post[] {
  return posts.filter((p) => p.kind === kind);
}

export interface Series {
  /** null: los tutoriales sueltos, sin serie. */
  name: string | null;
  /** Ancla en `/blog/tutoriales`. */
  slug: string;
  posts: Post[];
  /** Lo que duran sus videos, en segundos (0 si ninguno lo dice). */
  seconds: number;
}

/** Los tutoriales por serie, cada una en orden de episodio. Primero la serie con lo más nuevo; los sueltos, al final. */
export function tutorialSeries(posts = allPosts()): Series[] {
  const groups = new Map<string | null, Post[]>();
  for (const p of posts) {
    if (p.kind !== "tutorial") continue;
    const list = groups.get(p.series) ?? [];
    list.push(p);
    groups.set(p.series, list);
  }
  const out: Series[] = [...groups].map(([name, list]) => ({
    name,
    slug: name ? slugify(name) : "otros",
    posts: [...list].sort((a, b) => (a.episode ?? 1e6) - (b.episode ?? 1e6) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "es")),
    seconds: list.reduce((n, p) => n + (p.video ? (p.duration ?? 0) : 0), 0),
  }));
  const newest = (s: Series) => s.posts.reduce((d, p) => (p.date > d ? p.date : d), "");
  return out.sort((a, b) => Number(a.name === null) - Number(b.name === null) || newest(b).localeCompare(newest(a)) || (a.name ?? "").localeCompare(b.name ?? "", "es"));
}

/** La serie de un tutorial y sus vecinos en ella; null si no pertenece a ninguna. */
export function seriesOf(post: Post, posts = allPosts()): { series: Series; index: number; prev: Post | null; next: Post | null } | null {
  if (post.kind !== "tutorial" || !post.series) return null;
  const series = tutorialSeries(posts).find((s) => s.name === post.series);
  if (!series) return null;
  const index = series.posts.findIndex((p) => p.slug === post.slug);
  return { series, index, prev: series.posts[index - 1] ?? null, next: series.posts[index + 1] ?? null };
}

/** Otras entradas para seguir leyendo: primero las que comparten etiquetas, luego las del mismo tipo. */
export function relatedPosts(post: Post, count = 3, posts = allPosts()): Post[] {
  const others = posts.filter((p) => p.slug !== post.slug && !(post.series && p.series === post.series));
  const score = (p: Post) => p.tags.filter((t) => post.tags.includes(t)).length * 2 + Number(p.kind === post.kind);
  return others
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, count)
    .map((x) => x.p);
}

/** Los títulos de sección (`## …`) de un Markdown, para el índice de un artículo. */
export function headings(markdown: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^##\s+(.+?)\s*#*$/.exec(line);
    if (m) {
      const text = m[1]!.replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
      out.push({ id: slugify(text), text });
    }
  }
  return out;
}
