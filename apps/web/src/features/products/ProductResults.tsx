"use client";

import { useEffect, useRef, useState } from "react";
import { formatFieldValue, formatMoney, type ProductDto, type ProductFieldDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { ProductSourceMark } from "./ProductSourcesDialog";

export type ProductView = "grid" | "table";

interface Selectable {
  selected: ReadonlySet<string>;
  /** Hay algo elegido: las casillas se quedan a la vista. */
  selecting: boolean;
  onToggle: (p: ProductDto) => void;
  onOpen: (p: ProductDto) => void;
}

/** Los campos que van en la tarjeta (y como columnas en la tabla). */
export function cardFields(fields: ProductFieldDto[]): ProductFieldDto[] {
  return fields.filter((f) => f.showOnCard).slice(0, 4);
}

// ── Cuadrícula ──────────────────────────────────────────────

export function ProductGrid({ products, fields, ...sel }: { products: ProductDto[]; fields: ProductFieldDto[] } & Selectable) {
  const shown = cardFields(fields);
  return (
    <div className={`prod-grid${sel.selecting ? " is-selecting" : ""}`}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} fields={shown} checked={sel.selected.has(p.id)} onToggle={() => sel.onToggle(p)} onOpen={() => sel.onOpen(p)} />
      ))}
    </div>
  );
}

function ProductCard({
  product: p,
  fields,
  checked,
  onToggle,
  onOpen,
}: {
  product: ProductDto;
  fields: ProductFieldDto[];
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const details = fields.filter((f) => p.attributes[f.key]);
  return (
    <div className={`prod-card${checked ? " is-checked" : ""}${p.isActive ? "" : " is-inactive"}`}>
      <button type="button" onClick={onOpen} className="product-card prod-card__open" aria-label={`Editar ${p.name}`}>
        <div className="prod-card__thumb">
          {p.imageUrl && !broken ? (
            // Solo se descargan las fotos que llegan a verse.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
          ) : (
            <span className="prod-card__noimg">
              <NavIcon name={broken ? "alert" : "package"} size={26} />
            </span>
          )}
          {!p.isActive && <span className="prod-badge prod-card__inactive">Inactivo</span>}
          {p.source && <ProductSourceMark kind={p.source.kind} name={p.source.name} style={{ position: "absolute", bottom: 8, left: 8 }} />}
        </div>
        <div className="prod-card__body">
          <strong className="prod-card__name">{p.name}</strong>
          <span className="prod-muted">{p.sku ? `SKU ${p.sku}` : "Sin SKU"}</span>
          <span className="prod-card__price">{formatMoney(p.price, p.currency)}</span>
          {p.prices.length > 0 && (
            <span className="prod-prices">
              {p.prices.map((x) => (
                <span key={x.currency}>{formatMoney(x.amount, x.currency)}</span>
              ))}
            </span>
          )}
          {details.length > 0 && (
            <span className="pf-chips">
              {details.map((f) => (
                <span key={f.key} className="pf-chip">
                  <span>{f.label}</span> {formatFieldValue(f, p.attributes[f.key]!)}
                </span>
              ))}
            </span>
          )}
          {broken && <span className="prod-warn">La imagen no carga</span>}
        </div>
      </button>
      <label className="prod-check prod-card__check" title={checked ? "Quitar de la selección" : "Seleccionar"}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Seleccionar ${p.name}`} />
      </label>
    </div>
  );
}

// ── Tabla ───────────────────────────────────────────────────

export function ProductTable({
  products,
  fields,
  pageChecked,
  onTogglePage,
  ...sel
}: {
  products: ProductDto[];
  fields: ProductFieldDto[];
  /** all | some | none de esta página. */
  pageChecked: "all" | "some" | "none";
  onTogglePage: () => void;
} & Selectable) {
  const shown = cardFields(fields);
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (head.current) head.current.indeterminate = pageChecked === "some";
  }, [pageChecked]);

  return (
    <div className="prod-table-wrap">
      <table className="prod-table">
        <thead>
          <tr>
            <th className="prod-table__check">
              <input
                ref={head}
                type="checkbox"
                checked={pageChecked === "all"}
                onChange={onTogglePage}
                aria-label={pageChecked === "all" ? "Quitar la selección de esta página" : "Seleccionar esta página"}
              />
            </th>
            <th>Producto</th>
            <th className="num">Precio</th>
            {shown.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th>Origen</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <TableRow key={p.id} product={p} fields={shown} checked={sel.selected.has(p.id)} onToggle={() => sel.onToggle(p)} onOpen={() => sel.onOpen(p)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({
  product: p,
  fields,
  checked,
  onToggle,
  onOpen,
}: {
  product: ProductDto;
  fields: ProductFieldDto[];
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <tr className={`${checked ? "is-checked" : ""}${p.isActive ? "" : " is-inactive"}`} onClick={onOpen}>
      <td className="prod-table__check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Seleccionar ${p.name}`} />
      </td>
      <td>
        <div className="prod-table__product">
          <span className="prod-table__thumb">
            {p.imageUrl && !broken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
            ) : (
              <NavIcon name={broken ? "alert" : "package"} size={15} />
            )}
          </span>
          <span className="prod-table__names">
            <button type="button" className="prod-table__name" onClick={(e) => (e.stopPropagation(), onOpen())}>
              {p.name}
            </button>
            <span className="prod-muted">{p.sku ? `SKU ${p.sku}` : "Sin SKU"}</span>
          </span>
        </div>
      </td>
      <td className="num">
        <span className="prod-table__price">{formatMoney(p.price, p.currency)}</span>
        {p.prices.length > 0 && <span className="prod-muted prod-table__extra">{p.prices.map((x) => formatMoney(x.amount, x.currency)).join(" · ")}</span>}
      </td>
      {fields.map((f) => (
        <td key={f.key} className="prod-table__field">
          {p.attributes[f.key] ? formatFieldValue(f, p.attributes[f.key]!) : <span className="prod-muted">—</span>}
        </td>
      ))}
      <td>{p.source ? <ProductSourceMark kind={p.source.kind} name={p.source.name} /> : <span className="prod-muted">A mano</span>}</td>
      <td>{p.isActive ? <span className="prod-state is-on">Activo</span> : <span className="prod-state">Inactivo</span>}</td>
    </tr>
  );
}

// ── Barra de acciones en bloque ─────────────────────────────

export function ProductBulkBar({
  count,
  total,
  allMatching,
  canSelectAll,
  busy,
  onSelectAll,
  onClear,
  onRun,
}: {
  count: number;
  total: number;
  allMatching: boolean;
  /** La página entera está elegida y hay más que la cumplen: se ofrece elegirlos todos. */
  canSelectAll: boolean;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onRun: (action: "activate" | "deactivate" | "delete") => void;
}) {
  const n = count.toLocaleString("es");
  return (
    <div className="kb-bulk" role="toolbar" aria-label="Acciones con los productos elegidos" data-product-bulk>
      <div className="kb-bulk__count">
        <strong>{n}</strong> {count === 1 ? "elegido" : "elegidos"}
        {allMatching ? (
          <span className="prod-muted">todos los que cumplen los filtros</span>
        ) : (
          canSelectAll && (
            <button type="button" className="kb-bulk__link" onClick={onSelectAll} data-select-all>
              Elegir los {total.toLocaleString("es")} que cumplen los filtros
            </button>
          )
        )}
      </div>
      <div className="kb-bulk__actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onRun("activate")} data-bulk="activate">
          <NavIcon name="check" size={13} /> Activar
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onRun("deactivate")} data-bulk="deactivate">
          <NavIcon name="pause" size={13} /> Desactivar
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => onRun("delete")} data-bulk="delete">
          <NavIcon name="x" size={13} /> Eliminar
        </button>
      </div>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClear} aria-label="Quitar la selección" title="Quitar la selección">
        <NavIcon name="x" size={14} />
      </button>
    </div>
  );
}
