"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CATALOG_GAP_DAYS, type ProductDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { ghostBtn, smBtn } from "@/components/ui";
import { fetchCatalogGaps } from "@/lib/bff";

const COLLAPSED_KEY = "crm.catalogGaps.collapsed";
const SHOWN = 4;

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

/**
 * «Lo que preguntan y falta»: los datos que los clientes pidieron a la IA y el
 * producto no tiene, por producto y campo, con cuántos clientes y el último
 * chat. «Completar» abre el producto en ese campo. Sin nada que completar, no
 * ocupa sitio.
 */
export function CatalogGaps({ onComplete }: { onComplete: (product: ProductDto, fieldKey: string) => void }) {
  const { data: gaps = [] } = useQuery({ queryKey: ["catalog-gaps"], queryFn: fetchCatalogGaps, staleTime: 60_000 });
  const [collapsed, setCollapsed] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* sin almacenamiento: abierto */
    }
  }, []);

  if (!gaps.length) return null;

  const toggle = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, v ? "0" : "1");
      } catch {
        /* sin almacenamiento: solo en esta visita */
      }
      return !v;
    });
  const shown = all ? gaps : gaps.slice(0, SHOWN);

  return (
    <section className="cgaps" data-catalog-gaps aria-label="Lo que preguntan y falta">
      <button type="button" className="cgaps__head" onClick={toggle} aria-expanded={!collapsed}>
        <NavIcon name="question" size={15} />
        <span className="cgaps__title">Lo que preguntan y falta</span>
        <span className="cgaps__count">{gaps.length}</span>
        <span className="cgaps__chev" data-open={!collapsed || undefined}>
          <NavIcon name="chevron-down" size={14} />
        </span>
      </button>
      {!collapsed && (
        <>
          <p className="cgaps__hint">
            Datos que tus clientes pidieron a la IA en los últimos {CATALOG_GAP_DAYS} días y el producto no tiene. Complétalos y la IA
            podrá responder.
          </p>
          <ul className="cgaps__list">
            {shown.map((g) => (
              <li key={`${g.product.id}:${g.fieldKey}`} className="cgaps__row" data-gap={`${g.product.id}:${g.fieldKey}`}>
                <div className="cgaps__what">
                  <strong>«{g.field}»</strong> de <span className="cgaps__product">{g.product.name}</span>
                </div>
                <div className="cgaps__meta">
                  {g.conversations === 1 ? "1 cliente" : `${g.conversations} clientes`} · {ago(g.lastAskedAt)}
                </div>
                <div className="cgaps__actions">
                  <Link href={`/?c=${g.lastConversationId}`} className="cgaps__link" title="Abrir el último chat donde lo pidieron">
                    Ver chat
                  </Link>
                  <button type="button" style={{ ...ghostBtn, ...smBtn }} onClick={() => onComplete(g.product, g.fieldKey)} data-gap-complete>
                    Completar
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {gaps.length > SHOWN && (
            <button type="button" className="cgaps__more" onClick={() => setAll((v) => !v)}>
              {all ? "Ver menos" : `Ver ${gaps.length - SHOWN} más`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
