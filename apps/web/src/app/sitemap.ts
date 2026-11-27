import type { MetadataRoute } from "next";
import { allPosts } from "@/features/blog/posts";
import { DOCS } from "@/features/docs/registry";
import { absoluteUrl } from "@/lib/site";

// Se escribe en el build: lleva las páginas públicas que existen en ese momento.
export const dynamic = "force-static";

/** El mapa del sitio: la portada, los precios, la documentación y el blog. El panel no entra: pide sesión. */
export default function sitemap(): MetadataRoute.Sitemap {
  const posts = allPosts().filter((p) => !p.draft);
  const newest = posts.reduce((d, p) => ((p.updated ?? p.date) > d ? (p.updated ?? p.date) : d), "");
  const page = (path: string, priority: number, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: absoluteUrl(path),
    priority,
    ...(lastModified ? { lastModified } : {}),
  });
  return [
    page("/", 1),
    page("/precios", 0.9),
    page("/blog", 0.8, newest || undefined),
    ...(posts.some((p) => p.kind === "tutorial") ? [page("/blog/tutoriales", 0.7, newest)] : []),
    ...(posts.some((p) => p.kind === "articulo") ? [page("/blog/articulos", 0.7, newest)] : []),
    ...posts.map((p) => page(`/blog/${p.slug}`, 0.6, p.updated ?? p.date)),
    page("/docs", 0.7),
    ...DOCS.map((d) => page(`/docs/${d.slug}`, 0.5)),
    page("/terms", 0.2),
    page("/privacy", 0.2),
  ];
}
