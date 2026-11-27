import Link from "next/link";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugify } from "./frontmatter";
import { VideoPlayer } from "./VideoPlayer";
import { parseVideo } from "./video";

/** Lo que hace falta de un nodo del árbol HTML que entrega react-markdown. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (children && typeof children === "object" && "props" in children) {
    return textOf((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** El único hijo de un párrafo (sin contar espacios), o null si lleva más cosas. */
function onlyChild(node: HastNode | undefined): HastNode | null {
  const kids = (node?.children ?? []).filter((c) => !(c.type === "text" && !c.value?.trim()));
  return kids.length === 1 ? kids[0]! : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * El contenido de una entrada, de Markdown a HTML en el servidor. Además de lo
 * habitual: los títulos llevan ancla; una imagen sola en su línea sale como
 * figura (su «título» es el pie de foto); un enlace de YouTube solo en su línea
 * se convierte en el video; los enlaces de fuera abren en otra pestaña.
 */
export function PostBody({ markdown }: { markdown: string }) {
  return (
    <div className="bl-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // El título de la página ya es el <h1>: uno dentro del texto baja a <h2>.
          h1: ({ children }) => <h2>{children}</h2>,
          h2: ({ children }) => {
            const id = slugify(textOf(children));
            return (
              <h2 id={id}>
                <a href={`#${id}`} className="bl-anchor">
                  {children}
                </a>
              </h2>
            );
          },
          h3: ({ children }) => {
            const id = slugify(textOf(children));
            return (
              <h3 id={id}>
                <a href={`#${id}`} className="bl-anchor">
                  {children}
                </a>
              </h3>
            );
          },
          p: ({ node, children }) => {
            const only = onlyChild(node as HastNode | undefined);
            if (only?.tagName === "img") {
              const caption = str(only.properties?.title);
              return (
                <figure className="bl-figure">
                  <img src={str(only.properties?.src)} alt={str(only.properties?.alt)} loading="lazy" decoding="async" />
                  {caption && <figcaption>{caption}</figcaption>}
                </figure>
              );
            }
            if (only?.tagName === "a") {
              const href = str(only.properties?.href);
              const video = parseVideo(href);
              const label = (only.children ?? []).map((c) => c.value ?? "").join("");
              if (video?.type === "youtube" && label === href) return <VideoPlayer video={video} title="Video" />;
            }
            return <p>{children}</p>;
          },
          img: ({ src, alt }) => <img src={str(src)} alt={alt ?? ""} loading="lazy" decoding="async" className="bl-inline-img" />,
          a: ({ href, children }) => {
            if (href && href.startsWith("/") && !href.startsWith("//")) return <Link href={href}>{children}</Link>;
            const external = !!href && /^https?:\/\//.test(href);
            return (
              <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => <blockquote className="lp-bub bl-quote">{children}</blockquote>,
          table: ({ children }) => (
            <div className="bl-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
