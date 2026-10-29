"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

/**
 * Lo que comparten todas las páginas públicas (landing, precios): cabecera con
 * su menú móvil, pie, logotipos e iconos. Las páginas ponen el contenido.
 */

export const GITHUB = "https://github.com/jusiho/crm-prime";
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contacto@driony.com";

// Secciones de la landing: la etiqueta coincide con el título al que lleva.
export const NAV = [
  { id: "capacidades", label: "Capacidades" },
  { id: "como", label: "Cómo funciona" },
  { id: "porque", label: "Por qué Driony" },
  { id: "planes", label: "Planes" },
];

/** Desde la landing los anclajes son locales; desde otra página, vuelven a ella. */
const sectionHref = (id: string, home: boolean) => (home ? `#${id}` : `/#${id}`);

/**
 * Cabecera pública. `home` = estamos en la landing (anclajes locales y sección
 * activa); `active` marca el enlace actual.
 */
export function MarketingHeader({ active, home = false }: { active?: string | null; home?: boolean }) {
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [theme, toggleTheme] = useLpTheme();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Menú móvil: bloquea el scroll, deja la página inerte (así el Tab no se
  // escapa del diálogo), cierra con Esc y devuelve el foco al botón.
  useEffect(() => {
    if (!menuOpen) return;
    const root = document.getElementById("lp-root");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      root?.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      burgerRef.current?.focus();
    };
  }, [menuOpen]);

  return (
    <>
      <header className="lp-nav" data-scrolled={scrolled}>
        <div className="lp-wrap lp-nav__inner">
          <Link href="/" className="lp-brand" aria-label="Driony, inicio">
            <span className="lp-brand__mark">
              <Logo />
            </span>
            Driony
          </Link>
          <nav className="lp-nav__links" aria-label="Secciones">
            {NAV.map((n) => (
              <a key={n.id} href={sectionHref(n.id, home)} aria-current={home && active === n.id ? "true" : undefined}>
                {n.label}
              </a>
            ))}
            <Link href="/precios" aria-current={active === "precios" ? "true" : undefined}>
              Precios
            </Link>
            <Link href="/docs">Docs</Link>
          </nav>
          <div className="lp-nav__cta">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <Link href="/login" className="lp-nav__login">
              Iniciar sesión
            </Link>
            <Link href="/register" className="lp-btn lp-btn--primary">
              Empezar gratis
            </Link>
            <button
              ref={burgerRef}
              type="button"
              className="lp-burger"
              aria-label="Abrir menú"
              aria-expanded={menuOpen}
              aria-controls="lp-menu"
              onClick={() => setMenuOpen(true)}
            >
              <Burger />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && mounted && createPortal(<MobileMenu home={home} onClose={() => setMenuOpen(false)} theme={theme} onToggleTheme={toggleTheme} />, document.body)}
    </>
  );
}

/** Pie público: enlaces, legal y el distintivo de partner de Meta. */
export function MarketingFooter({ home = false }: { home?: boolean }) {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot__inner">
        <span className="lp-brand" style={{ fontSize: 16 }}>
          <span className="lp-brand__mark" style={{ width: 26, height: 26 }}>
            <Logo />
          </span>
          Driony
        </span>
        <nav className="lp-foot__links" aria-label="Pie de página">
          <a href={sectionHref("capacidades", home)}>Capacidades</a>
          <Link href="/precios">Precios</Link>
          <Link href="/docs">Documentación</Link>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href={`mailto:${CONTACT}`}>Contacto</a>
          <Link href="/terms">Términos</Link>
          <Link href="/privacy">Privacidad</Link>
        </nav>
        <span className="lp-foot__right">
          <span className="lp-partner lp-partner--foot" title="Driony forma parte del programa de partners de Meta">
            <MetaMark />
            Meta Business Partner
          </span>
          <span>© 2026 Driony</span>
        </span>
      </div>
    </footer>
  );
}

/* ── Tema claro / oscuro ─────────────────────────────────────
   Se guarda en el navegador y también se puede forzar con ?tema=claro u
   ?tema=oscuro (para compartir un enlace). Un script en línea lo aplica
   mientras se lee el HTML, así la página no parpadea en oscuro. */
export type LpTheme = "dark" | "light";
const LP_THEME_KEY = "lp-theme";
const LP_THEME_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("tema");var t=q==="claro"||q==="light"?"light":q==="oscuro"||q==="dark"?"dark":null;if(t)localStorage.setItem("${LP_THEME_KEY}",t);else t=localStorage.getItem("${LP_THEME_KEY}");if(t==="light"){var r=document.currentScript&&document.currentScript.parentElement;if(r)r.setAttribute("data-theme","light");}}catch(e){}})();`;

/* Variante de marca en prueba (lima sobre carbón): ?marca=lima la activa
   y ?marca=violeta la quita. Dura la sesión del navegador. */
const LP_BRAND_KEY = "lp-brand";
const LP_BRAND_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;var q=new URLSearchParams(location.search).get("marca");if(q==="lima")sessionStorage.setItem("${LP_BRAND_KEY}","lima");else if(q)sessionStorage.removeItem("${LP_BRAND_KEY}");if(r&&sessionStorage.getItem("${LP_BRAND_KEY}")==="lima")r.setAttribute("data-brand","lima");}catch(e){}})();`;

/** Primer hijo de la raíz .lp: aplica el tema guardado antes de pintar. */
export function LpThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: LP_THEME_SCRIPT + LP_BRAND_SCRIPT }} />;
}

function useLpTheme(): [LpTheme, () => void] {
  const [theme, setTheme] = useState<LpTheme>("dark");
  useEffect(() => {
    const root = document.getElementById("lp-root");
    // Navegación en cliente: el script en línea no se ejecuta, así que se aplica aquí.
    let t: LpTheme = root?.getAttribute("data-theme") === "light" ? "light" : "dark";
    try {
      if (localStorage.getItem(LP_THEME_KEY) === "light") t = "light";
      if (sessionStorage.getItem(LP_BRAND_KEY) === "lima") root?.setAttribute("data-brand", "lima");
    } catch {}
    root?.setAttribute("data-theme", t);
    setTheme(t);
  }, []);
  const toggle = () => {
    const next: LpTheme = theme === "light" ? "dark" : "light";
    document.getElementById("lp-root")?.setAttribute("data-theme", next);
    try {
      localStorage.setItem(LP_THEME_KEY, next);
    } catch {}
    setTheme(next);
  };
  return [theme, toggle];
}

function ThemeToggle({ theme, onToggle, withLabel = false }: { theme: LpTheme; onToggle: () => void; withLabel?: boolean }) {
  const label = theme === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro";
  return (
    <button type="button" className="lp-theme" onClick={onToggle} aria-label={label} title={label}>
      {theme === "light" ? <Moon /> : <Sun />}
      {withLabel && <span>{theme === "light" ? "Tema oscuro" : "Tema claro"}</span>}
    </button>
  );
}

/* ── Menú móvil: <dialog> modal (trampa de foco y Esc nativos), por portal ── */
function MobileMenu({ home, onClose, theme, onToggleTheme }: { home: boolean; onClose: () => void; theme: LpTheme; onToggleTheme: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const firstRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    firstRef.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="lp lp-menu"
      id="lp-menu"
      data-theme={theme}
      data-brand={typeof document === "undefined" ? undefined : document.getElementById("lp-root")?.getAttribute("data-brand") ?? undefined}
      aria-label="Menú"
      lang="es"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="lp-menu__top">
        <span className="lp-brand">
          <span className="lp-brand__mark">
            <Logo />
          </span>
          Driony
        </span>
        <button type="button" className="lp-menu__close" aria-label="Cerrar menú" onClick={onClose}>
          <Close />
        </button>
      </div>
      <nav className="lp-menu__links" aria-label="Secciones">
        {NAV.map((n, i) => (
          <a key={n.id} href={sectionHref(n.id, home)} onClick={onClose} ref={i === 0 ? firstRef : undefined}>
            {n.label}
          </a>
        ))}
        <Link href="/precios" onClick={onClose}>
          Precios
        </Link>
        <Link href="/docs" onClick={onClose}>
          Docs
        </Link>
      </nav>
      <div className="lp-menu__cta">
        <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg" onClick={onClose}>
          Empezar gratis <Arrow />
        </Link>
        <Link href="/login" className="lp-btn lp-btn--ghost lp-btn--lg" onClick={onClose}>
          Iniciar sesión
        </Link>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} withLabel />
      </div>
    </dialog>
  );
}

/* ── Iconografía (línea coherente, trazo 1.75) ── */
function Sun() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </svg>
  );
}
function Moon() {
  return (
    <svg {...S}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}
const S = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function Logo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11.5a8 8 0 1 1 3.2 6.4L4 19l1.1-3.2A7.9 7.9 0 0 1 4 11.5Z" />
      <path d="M9 10.5c.4 2.2 2.3 4.1 4.5 4.5" />
    </svg>
  );
}
/** Logotipo de Meta, monocromo (hereda el color del texto). */
export function MetaMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" />
    </svg>
  );
}

export function Burger() {
  return (
    <svg {...S} width="20" height="20">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
export function Close() {
  return (
    <svg {...S} width="20" height="20">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
export function Arrow() {
  return (
    <svg {...S} width="17" height="17">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
export function Check() {
  return (
    <svg {...S} width="16" height="16">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
export function Minus() {
  return (
    <svg {...S} width="16" height="16">
      <path d="M5 12h14" />
    </svg>
  );
}
export function Pause() {
  return (
    <svg {...S} width="16" height="16" fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
export function Play() {
  return (
    <svg {...S} width="16" height="16" fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}
export function IconGit() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
