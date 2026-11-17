"use client";

import { NavIcon } from "@/components/NavIcons";

/** Páginas a enseñar, con huecos: 1 … 4 5 6 … 20. */
export function pageList(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  if (start > 2) out.push("gap");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

/**
 * Paginación numerada. En pantallas estrechas se queda en «Anterior · 3 de 20 ·
 * Siguiente» (los números no caben).
 */
export function Pagination({
  page,
  pages,
  onPage,
  label = "Páginas",
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="pager__btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
        <NavIcon name="chevron-left" size={14} />
        <span className="pager__word">Anterior</span>
      </button>
      <span className="pager__pages">
        {pageList(page, pages).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="pager__gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className="pager__num"
              aria-current={p === page ? "page" : undefined}
              aria-label={`Página ${p}`}
              onClick={() => p !== page && onPage(p)}
            >
              {p}
            </button>
          ),
        )}
      </span>
      <span className="pager__status">
        {page} de {pages}
      </span>
      <button type="button" className="pager__btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
        <span className="pager__word">Siguiente</span>
        <NavIcon name="chevron-right" size={14} />
      </button>
    </nav>
  );
}
