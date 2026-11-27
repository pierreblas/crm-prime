import type { Metadata } from "next";
import { BLOG_FEEDS } from "@/features/blog/frontmatter";
import { allPosts, postsOfKind, tutorialSeries } from "@/features/blog/posts";
import { BlogEnd, BlogHero, Empty, SeriesBlock, Tabs } from "@/features/blog/parts";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Tutoriales",
  description: "Tutoriales de Driony, una función en cada uno: crear tu agente de IA, probarlo, los seguimientos, la bandeja y el trabajo en equipo.",
  alternates: { canonical: "/blog/tutoriales", types: BLOG_FEEDS },
};

/** Todos los tutoriales, por serie y en orden de episodio. */
export default function TutorialsPage() {
  const posts = allPosts();
  const series = tutorialSeries(posts);
  const tutorials = postsOfKind("tutorial", posts).length;

  return (
    <>
      <BlogHero title="Tutoriales, paso a paso.">
        Una función de Driony en cada uno, con la pantalla real y sin relleno. Están ordenados por serie: empieza por el
        primero o ve directo al que necesitas.
      </BlogHero>

      <section className="lp-section lp-section--first">
        <div className="lp-wrap bl-stack">
          <Tabs active="tutorial" counts={{ tutorial: tutorials, articulo: posts.length - tutorials }} />
          {series.length === 0 && <Empty>Todavía no hay tutoriales publicados. Vuelve pronto.</Empty>}
          {series.map((s) => (
            <SeriesBlock key={s.slug} series={s} />
          ))}
        </div>
      </section>

      <BlogEnd />
    </>
  );
}
