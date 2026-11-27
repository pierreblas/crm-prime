import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/BrandMark";
import { TRIAL_DAYS } from "@crm/shared";
import { durationLabel, formatDate, KIND_LABEL, type Post, type PostKind } from "./frontmatter";
import type { Series } from "./posts";
import { clock } from "./video";

/** Las piezas que comparten las páginas del blog: portada, tarjeta, serie, pestañas y cierre. */

const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export function Arrow() {
  return (
    <svg {...ICON} width="17" height="17">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
export function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/** «1 min de video» o «4 min de lectura». */
export function lengthLabel(post: Post): string {
  if (post.video && post.duration) return `${durationLabel(post.duration)} de video`;
  return `${post.readingMinutes} min de lectura`;
}

const two = (n: number) => String(n).padStart(2, "0");

/** La imagen de una entrada. Sin imagen, una portada con la marca: nunca queda un hueco. */
export function Cover({ post, eager = false }: { post: Post; eager?: boolean }) {
  return (
    <span className={`bl-cover${post.cover ? "" : " bl-cover--blank"}`}>
      {post.cover ? (
        <img src={post.cover} alt={post.coverAlt ?? ""} width={1280} height={720} loading={eager ? "eager" : "lazy"} decoding="async" />
      ) : (
        <span className="lp-bub lp-bub--out bl-cover__bub" aria-hidden="true">
          {post.series ?? post.tags[0] ?? KIND_LABEL[post.kind]}
        </span>
      )}
      {post.video && (
        <span className="bl-cover__play" aria-hidden="true">
          <PlayIcon />
        </span>
      )}
      {post.video && post.duration ? <span className="bl-cover__time">{clock(post.duration)}</span> : null}
      {post.draft && <span className="bl-cover__draft">Borrador</span>}
    </span>
  );
}

/** Una entrada en un listado. `big` es la destacada; `numbered` enseña el número de episodio. */
export function PostCard({ post, big = false, numbered = false, eager = false }: { post: Post; big?: boolean; numbered?: boolean; eager?: boolean }) {
  const Title = big ? "h2" : "h3";
  return (
    <Link href={`/blog/${post.slug}`} className={`bl-card${big ? " bl-card--big" : ""}`}>
      <Cover post={post} eager={eager} />
      <span className="bl-card__body">
        <span className="bl-card__meta">
          <span className={`bl-kind bl-kind--${post.kind}`}>{numbered && post.episode ? `Episodio ${two(post.episode)}` : KIND_LABEL[post.kind]}</span>
          <span>{lengthLabel(post)}</span>
        </span>
        <Title className="bl-card__title">{post.title}</Title>
        <span className="bl-card__desc">{post.description}</span>
        {big && <span className="bl-card__date">{formatDate(post.date)}</span>}
      </span>
    </Link>
  );
}

/** «7 videos · 5 min en total»; mientras a alguno le falte el video, «7 tutoriales». */
export function seriesMeta(series: Series): string {
  const n = series.posts.length;
  if (series.posts.some((p) => !p.video)) return `${n} ${n === 1 ? "tutorial" : "tutoriales"}`;
  const count = `${n} ${n === 1 ? "video" : "videos"}`;
  return series.seconds ? `${count} · ${durationLabel(series.seconds)} en total` : count;
}

/** Una serie de tutoriales con sus episodios. Con `limit`, solo los primeros y un enlace al resto. */
export function SeriesBlock({ series, limit, level = 2 }: { series: Series; limit?: number; level?: 2 | 3 }) {
  const Title = level === 2 ? "h2" : "h3";
  const shown = limit ? series.posts.slice(0, limit) : series.posts;
  const more = series.posts.length - shown.length;
  return (
    <section className="bl-series" id={limit ? undefined : series.slug} aria-label={series.name ?? "Más tutoriales"}>
      <header className="bl-series__head">
        <div>
          {series.name && <p className="bl-kicker">Serie</p>}
          <Title className="bl-series__title">{series.name ?? "Más tutoriales"}</Title>
          <p className="bl-series__meta">{seriesMeta(series)}</p>
        </div>
        {more > 0 && (
          <Link href={`/blog/tutoriales#${series.slug}`} className="bl-more">
            Ver los {series.posts.length} <Arrow />
          </Link>
        )}
      </header>
      <div className="bl-grid">
        {shown.map((p) => (
          <PostCard key={p.slug} post={p} numbered={!!series.name} />
        ))}
      </div>
    </section>
  );
}

/** Todo · Tutoriales · Artículos. Un tipo sin entradas no sale. */
export function Tabs({ active, counts }: { active: "todo" | PostKind; counts: Record<PostKind, number> }) {
  const tabs: { key: "todo" | PostKind; href: string; label: string; n: number }[] = [
    { key: "todo", href: "/blog", label: "Todo", n: counts.tutorial + counts.articulo },
    { key: "tutorial", href: "/blog/tutoriales", label: "Tutoriales", n: counts.tutorial },
    { key: "articulo", href: "/blog/articulos", label: "Artículos", n: counts.articulo },
  ];
  const shown = tabs.filter((t) => t.key === "todo" || t.n > 0 || t.key === active);
  if (shown.length < 3 && active === "todo") return null;
  return (
    <nav className="bl-tabs" aria-label="Qué quieres ver">
      {shown.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}>
          {t.label} <span>{t.n}</span>
        </Link>
      ))}
    </nav>
  );
}

/** El título de un listado, en grande: el globo niebla de las páginas públicas. */
export function BlogHero({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lp-phero lp-petrol bl-hero">
      <div className="lp-bub lp-bub--out lp-phero__giant">
        <h1>{title}</h1>
        <p className="lp-lede">{children}</p>
      </div>
    </section>
  );
}

/** Cuando todavía no hay nada que enseñar. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="bl-empty">
      <p>{children}</p>
      <Link href="/blog" className="lp-btn lp-btn--ghost">
        Volver al blog
      </Link>
    </div>
  );
}

/** El cierre de todas las páginas del blog: el globo lima con la invitación a probar. */
export function BlogEnd() {
  return (
    <section className="lp-end lp-petrol">
      <div className="lp-bub lp-bub--out lp-end__giant lp-lime">
        <h2>Pruébalo en tu WhatsApp.</h2>
        <p>
          Crea tu cuenta en dos minutos y pon a tu agente a responder hoy. {TRIAL_DAYS} días de Pro gratis, sin tarjeta.
        </p>
        <div className="lp-cta__row">
          <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
            Empezar gratis <Arrow />
          </Link>
          <Link href="/docs" className="lp-btn lp-btn--ghost lp-btn--lg">
            Ver la documentación
          </Link>
        </div>
      </div>
      <div className="lp-end__sign" aria-hidden="true">
        <Wordmark size={46} />
      </div>
    </section>
  );
}
