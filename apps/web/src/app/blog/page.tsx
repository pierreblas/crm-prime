import type { Metadata } from "next";
import { BLOG_FEEDS } from "@/features/blog/frontmatter";
import { allPosts, postsOfKind, tutorialSeries } from "@/features/blog/posts";
import { BlogEnd, BlogHero, Empty, PostCard, SeriesBlock, Tabs } from "@/features/blog/parts";

// Se escribe en el build, como la documentación: las entradas se leen entonces.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: { absolute: "Blog de Driony — Tutoriales y artículos para vender por WhatsApp" },
  alternates: { canonical: "/blog", types: BLOG_FEEDS },
  openGraph: {
    title: "Blog de Driony",
    description: "Tutoriales y artículos para vender por WhatsApp con agentes de IA.",
    type: "website",
    url: "/blog",
    locale: "es_ES",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Driony" }],
  },
};

/** Cuántos episodios de cada serie se enseñan en la portada del blog. */
const PER_SERIES = 3;

/** Portada del blog: el último artículo, los tutoriales por serie y el resto de artículos. */
export default function BlogPage() {
  const posts = allPosts();
  const articles = postsOfKind("articulo", posts);
  const series = tutorialSeries(posts);
  const [featured, ...rest] = articles;
  const counts = { articulo: articles.length, tutorial: posts.length - articles.length };

  return (
    <>
      <BlogHero title="Aprende a vender por WhatsApp.">
        Tutoriales paso a paso y artículos para sacarle partido a Driony: tus agentes de IA, la bandeja, el embudo y lo que
        va cambiando en WhatsApp.
      </BlogHero>

      <section className="lp-section lp-section--first">
        <div className="lp-wrap bl-stack">
          <Tabs active="todo" counts={counts} />
          {posts.length === 0 && <Empty>Estamos preparando las primeras entradas. Vuelve pronto.</Empty>}
          {featured && <PostCard post={featured} big eager />}
          {series.length > 0 && (
            <div className="bl-stack">
              {articles.length > 0 && <h2 className="bl-heading">Tutoriales</h2>}
              {series.map((s) => (
                <SeriesBlock key={s.slug} series={s} limit={PER_SERIES} level={articles.length > 0 ? 3 : 2} />
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <section className="bl-series" aria-label="Más artículos">
              <header className="bl-series__head">
                <h2 className="bl-series__title">Más artículos</h2>
              </header>
              <div className="bl-grid">
                {rest.map((p) => (
                  <PostCard key={p.slug} post={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      </section>

      <BlogEnd />
    </>
  );
}
