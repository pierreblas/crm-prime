import type { Metadata } from "next";
import { BLOG_FEEDS } from "@/features/blog/frontmatter";
import { allPosts, postsOfKind } from "@/features/blog/posts";
import { BlogEnd, BlogHero, Empty, PostCard, Tabs } from "@/features/blog/parts";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Artículos",
  description: "Artículos de Driony sobre vender por WhatsApp: agentes de IA, seguimientos, plantillas y lo que cambia en las reglas y los precios de Meta.",
  alternates: { canonical: "/blog/articulos", types: BLOG_FEEDS },
};

/** Todos los artículos, del más nuevo al más antiguo. */
export default function ArticlesPage() {
  const posts = allPosts();
  const [featured, ...rest] = postsOfKind("articulo", posts);
  const articles = rest.length + (featured ? 1 : 0);

  return (
    <>
      <BlogHero title="Artículos para vender mejor.">
        Ideas y guías sobre WhatsApp, agentes de IA y ventas por chat, y lo que cambia en las reglas y los precios de Meta,
        explicado sin rodeos.
      </BlogHero>

      <section className="lp-section lp-section--first">
        <div className="lp-wrap bl-stack">
          <Tabs active="articulo" counts={{ articulo: articles, tutorial: posts.length - articles }} />
          {!featured && <Empty>Todavía no hay artículos publicados. Vuelve pronto.</Empty>}
          {featured && <PostCard post={featured} big eager />}
          {rest.length > 0 && (
            <div className="bl-grid">
              {rest.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      <BlogEnd />
    </>
  );
}
