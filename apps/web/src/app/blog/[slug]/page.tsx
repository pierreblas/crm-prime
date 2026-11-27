import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_FEEDS, DEFAULT_AUTHOR, formatDate, KIND_LABEL, KIND_PATH, type Post } from "@/features/blog/frontmatter";
import { allPosts, findPost, headings, relatedPosts, seriesOf } from "@/features/blog/posts";
import { Arrow, BlogEnd, lengthLabel, PostCard } from "@/features/blog/parts";
import { PostBody } from "@/features/blog/PostBody";
import { VideoPlayer } from "@/features/blog/VideoPlayer";
import { clock, isoDuration, parseVideo } from "@/features/blog/video";
import { absoluteUrl } from "@/lib/site";

// Todas se escriben en el build (el Markdown se lee entonces); una dirección
// que no es una entrada es un 404, no una lectura en caliente.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return allPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) return {};
  const image = post.cover ?? "/og.png";
  return {
    title: post.title,
    description: post.description,
    keywords: post.tags.length ? post.tags : undefined,
    authors: [{ name: post.author }],
    alternates: { canonical: `/blog/${post.slug}`, types: BLOG_FEEDS },
    // Un borrador solo se ve en local, pero por si acaso no se indexa.
    robots: post.draft ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      siteName: "Driony",
      locale: "es_ES",
      publishedTime: post.date,
      modifiedTime: post.updated ?? undefined,
      tags: post.tags,
      images: [{ url: image, alt: post.coverAlt ?? post.title }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [image] },
  };
}

/** Lo que leen los buscadores: la entrada, su video si lo tiene y dónde está dentro del sitio. */
function structuredData(post: Post): object[] {
  const url = absoluteUrl(`/blog/${post.slug}`);
  const image = absoluteUrl(post.cover ?? "/og.png");
  const video = parseVideo(post.video);
  const publisher = { "@type": "Organization", name: "Driony", url: absoluteUrl("/") };
  const data: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      image: [image],
      datePublished: post.date,
      dateModified: post.updated ?? post.date,
      inLanguage: "es",
      url,
      mainEntityOfPage: url,
      author: post.author === DEFAULT_AUTHOR ? publisher : { "@type": "Person", name: post.author },
      publisher,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Blog", item: absoluteUrl("/blog") },
        { "@type": "ListItem", position: 2, name: post.kind === "tutorial" ? "Tutoriales" : "Artículos", item: absoluteUrl(KIND_PATH[post.kind]) },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (video) {
    data.push({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: post.title,
      description: post.description,
      thumbnailUrl: [image],
      uploadDate: `${post.date}T00:00:00Z`,
      ...(post.duration ? { duration: isoDuration(post.duration) } : {}),
      ...(video.type === "youtube" ? { embedUrl: `https://www.youtube.com/embed/${video.id}` } : { contentUrl: absoluteUrl(video.src) }),
    });
  }
  return data;
}

const two = (n: number) => String(n).padStart(2, "0");

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) notFound();

  const video = parseVideo(post.video);
  const inSeries = seriesOf(post);
  const toc = post.kind === "articulo" ? headings(post.body) : [];
  const related = relatedPosts(post, 3);
  const media = !!video || !!post.cover;
  const side = !!inSeries || toc.length > 1;

  return (
    <>
      <article className={`bl-post${media ? " bl-post--media" : ""}`}>
        <header className="bl-post__head lp-petrol">
          <div className="lp-wrap">
            <nav className="bl-crumb" aria-label="Dónde estás">
              <Link href="/blog">Blog</Link>
              <span aria-hidden="true">/</span>
              <Link href={KIND_PATH[post.kind]}>{post.kind === "tutorial" ? "Tutoriales" : "Artículos"}</Link>
              {inSeries && (
                <>
                  <span aria-hidden="true">/</span>
                  <Link href={`/blog/tutoriales#${inSeries.series.slug}`}>{inSeries.series.name}</Link>
                </>
              )}
            </nav>
            <h1>{post.title}</h1>
            <p className="bl-post__lede">{post.description}</p>
            <p className="bl-post__meta">
              {post.draft && <span className="bl-post__draft">Borrador: no se publica</span>}
              <span>{inSeries && post.episode ? `Episodio ${post.episode} de ${inSeries.series.posts.length}` : KIND_LABEL[post.kind]}</span>
              <span>{lengthLabel(post)}</span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              {post.updated && post.updated !== post.date && <span>Actualizado el {formatDate(post.updated)}</span>}
            </p>
          </div>
        </header>

        <div className={`lp-wrap bl-post__layout${side ? "" : " bl-post__layout--single"}`}>
          <div className="bl-post__main">
            {video ? (
              <VideoPlayer video={video} title={post.title} poster={post.cover} duration={post.duration} captions={post.captions} />
            ) : post.cover ? (
              <figure className="bl-post__cover">
                <img src={post.cover} alt={post.coverAlt ?? ""} width={1280} height={720} decoding="async" />
              </figure>
            ) : null}

            {post.body && <PostBody markdown={post.body} />}

            {post.docs && (
              <Link href={post.docs} className="bl-docs">
                <span>
                  <strong>La guía completa, en la documentación</strong>
                  <span>Todas las opciones de esta función, con sus detalles y límites.</span>
                </span>
                <Arrow />
              </Link>
            )}

            {post.tags.length > 0 && (
              <ul className="bl-tags" aria-label="Temas">
                {post.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}

            {inSeries && (inSeries.prev || inSeries.next) && (
              <nav className="bl-pager" aria-label="Otros episodios de la serie">
                {inSeries.prev ? (
                  <Link href={`/blog/${inSeries.prev.slug}`} className="bl-pager__link">
                    <span>Episodio anterior</span>
                    <strong>{inSeries.prev.title}</strong>
                  </Link>
                ) : (
                  <span />
                )}
                {inSeries.next && (
                  <Link href={`/blog/${inSeries.next.slug}`} className="bl-pager__link bl-pager__link--next">
                    <span>Siguiente episodio</span>
                    <strong>{inSeries.next.title}</strong>
                  </Link>
                )}
              </nav>
            )}
          </div>

          {side && (
            <aside className="bl-post__side">
              {inSeries ? (
                <nav className="bl-list" aria-label={`Serie ${inSeries.series.name}`}>
                  <p className="bl-kicker">Serie</p>
                  <p className="bl-list__title">{inSeries.series.name}</p>
                  <ol>
                    {inSeries.series.posts.map((p, i) => (
                      <li key={p.slug}>
                        <Link href={`/blog/${p.slug}`} aria-current={p.slug === post.slug ? "page" : undefined}>
                          <span className="bl-list__n">{two(p.episode ?? i + 1)}</span>
                          <span className="bl-list__name">{p.title}</span>
                          {p.video && p.duration ? <span className="bl-list__time">{clock(p.duration)}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : (
                <nav className="bl-list bl-list--toc" aria-label="En este artículo">
                  <p className="bl-kicker">En este artículo</p>
                  <ol>
                    {toc.map((h) => (
                      <li key={h.id}>
                        <a href={`#${h.id}`}>
                          <span className="bl-list__name">{h.text}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
            </aside>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="lp-section lp-band bl-related">
          <div className="lp-wrap">
            <h2 className="bl-heading">Sigue con esto</h2>
            <div className="bl-grid">
              {related.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      <BlogEnd />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(post)).replace(/</g, "\\u003c") }} />
    </>
  );
}
