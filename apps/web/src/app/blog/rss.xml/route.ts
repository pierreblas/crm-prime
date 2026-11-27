import { allPosts } from "@/features/blog/posts";
import { absoluteUrl } from "@/lib/site";

// Se escribe en el build, con las entradas publicadas en ese momento.
export const dynamic = "force-static";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** El blog como RSS, para lectores de noticias y para automatizar avisos de entradas nuevas. */
export function GET() {
  const posts = allPosts().filter((p) => !p.draft);
  const items = posts
    .map((p) => {
      const url = absoluteUrl(`/blog/${p.slug}`);
      return [
        "    <item>",
        `      <title>${esc(p.title)}</title>`,
        `      <link>${esc(url)}</link>`,
        `      <guid isPermaLink="true">${esc(url)}</guid>`,
        `      <description>${esc(p.description)}</description>`,
        `      <pubDate>${new Date(`${p.date}T12:00:00Z`).toUTCString()}</pubDate>`,
        `      <category>${p.kind === "tutorial" ? "Tutoriales" : "Artículos"}</category>`,
        ...p.tags.map((t) => `      <category>${esc(t)}</category>`),
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog de Driony</title>
    <link>${esc(absoluteUrl("/blog"))}</link>
    <description>Tutoriales y artículos para vender por WhatsApp con agentes de IA.</description>
    <language>es</language>
    <atom:link href="${esc(absoluteUrl("/blog/rss.xml"))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
