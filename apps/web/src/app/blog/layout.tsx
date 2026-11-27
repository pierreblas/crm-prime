import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "@/features/marketing/chrome";
import "@/features/marketing/landing.css";
import "@/features/blog/blog.css";
import { BLOG_FEEDS } from "@/features/blog/frontmatter";

export const metadata: Metadata = {
  title: { default: "Blog — Driony", template: "%s — Blog de Driony" },
  description: "Tutoriales y artículos para vender por WhatsApp con agentes de IA: cómo usar Driony paso a paso y qué cambia en WhatsApp y Meta.",
  alternates: { types: BLOG_FEEDS },
};

/**
 * El blog público: tutoriales y artículos, en el dominio raíz y sin sesión.
 * Lleva la misma cabecera y el mismo pie que la portada y los precios.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp" id="lp-root" lang="es" suppressHydrationWarning>
      <a href="#contenido" className="lp-skip">
        Saltar al contenido
      </a>
      <MarketingHeader active="blog" />
      <main id="contenido">{children}</main>
      <MarketingFooter />
    </div>
  );
}
