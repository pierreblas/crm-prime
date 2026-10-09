"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import {
  CURRENCIES,
  formatFieldValue,
  formatMoney,
  type CreateProductInput,
  type ProductDto,
  type ProductFieldDto,
} from "@crm/shared";
import {
  createProduct,
  deleteProduct,
  fetchProductFields,
  fetchProducts,
  updateProduct,
} from "@/lib/bff";
import { dangerBtn, ghostBtn, input, label, primaryBtn, smBtn } from "@/components/ui";
import { ImportProductsDialog } from "./ImportProductsDialog";
import { ProductFieldInput, ProductFieldsDialog } from "./ProductFieldsDialog";

// Al pegar una imagen es fácil olvidar el esquema ("midominio.com/foto.jpg").
// Se añade https:// para que no lo rechace la validación de URL.
function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

type Filter = "all" | "active" | "inactive";

export function ProductsManager() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<ProductDto | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const { data: fields = [] } = useQuery({ queryKey: ["product-fields"], queryFn: fetchProductFields });

  const { data: products, isPending, isError } = useQuery({
    queryKey: ["products", search],
    queryFn: () => fetchProducts(search),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products"] });

  const list = (products ?? []).filter((p) =>
    filter === "all" ? true : filter === "active" ? p.isActive : !p.isActive,
  );
  const activeCount = (products ?? []).filter((p) => p.isActive).length;

  return (
    <div style={page}>
      <div style={toolbar}>
        <label style={searchBox}>
          <NavIcon name="search" size={16} />
          <input
            style={searchInput}
            value={search}
            placeholder="Buscar por nombre o SKU"
            aria-label="Buscar productos"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="seg" role="tablist" aria-label="Filtrar productos">
          {(
            [
              ["all", `Todos · ${products?.length ?? 0}`],
              ["active", `Activos · ${activeCount}`],
              ["inactive", `Inactivos · ${(products?.length ?? 0) - activeCount}`],
            ] as const
          ).map(([k, text]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
              {text}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setFieldsOpen(true)} style={ghostBtn} title="Los datos que guardas de cada producto, servicio o taller">
          <NavIcon name="tag" size={15} /> Campos{fields.length > 0 ? ` · ${fields.length}` : ""}
        </button>
        <button onClick={() => setImporting(true)} style={ghostBtn} data-tour="products-import">
          <NavIcon name="file" size={15} /> Importar
        </button>
        <button onClick={() => setEditing("new")} style={primaryBtn} data-tour="products-new">
          <NavIcon name="plus" size={15} /> Nuevo producto
        </button>
      </div>

      {fieldsOpen && <ProductFieldsDialog fields={fields} onClose={() => setFieldsOpen(false)} />}

      {importing && (
        <ImportProductsDialog
          onClose={() => setImporting(false)}
          onImported={refresh}
          suggestedCurrency={mostUsedCurrency(products ?? [])}
        />
      )}

      {editing && (
        <ProductDrawer
          // La clave reinicia el formulario al cambiar de producto.
          key={editing === "new" ? "new" : editing.id}
          product={editing === "new" ? null : editing}
          fields={fields}
          onManageFields={() => setFieldsOpen(true)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {isPending && (
        <div style={grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 210, borderRadius: 12 }} />
          ))}
        </div>
      )}
      {isError && <p style={{ color: "var(--danger)" }}>No se pudieron cargar los productos.</p>}

      {!isPending && list.length === 0 && (
        <div style={empty}>
          <NavIcon name="package" size={32} />
          <strong style={{ color: "var(--text)" }}>
            {search || filter !== "all" ? "Nada coincide con la búsqueda" : "Aún no tienes productos"}
          </strong>
          <span>
            {search || filter !== "all"
              ? "Prueba con otro nombre o SKU."
              : "Crea el primero o importa tu catálogo desde Excel o CSV. El agente de IA los usa para dar precios."}
          </span>
        </div>
      )}

      <div style={grid} data-tour="products-grid">
        {list.map((p) => (
          <ProductCard key={p.id} product={p} fields={fields} onOpen={() => setEditing(p)} />
        ))}
      </div>
    </div>
  );
}

function ProductCard({ product: p, fields, onOpen }: { product: ProductDto; fields: ProductFieldDto[]; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const details = fields.filter((f) => f.showOnCard && p.attributes[f.key]).slice(0, 4);
  return (
    <button type="button" onClick={onOpen} style={card} className="product-card" aria-label={`Editar ${p.name}`}>
      <div style={thumb}>
        {p.imageUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl}
            alt=""
            onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ color: "var(--muted)", opacity: 0.6 }}>
            <NavIcon name={broken ? "alert" : "package"} size={26} />
          </span>
        )}
        {!p.isActive && <span style={inactiveBadge}>Inactivo</span>}
      </div>
      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <strong style={cardTitle}>{p.name}</strong>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.sku ? `SKU ${p.sku}` : "Sin SKU"}</span>
        <span style={cardPrice}>{formatMoney(p.price, p.currency)}</span>
        {p.prices.length > 0 && (
          <span style={priceChips}>
            {p.prices.map((x) => (
              <span key={x.currency} style={priceChip}>
                {formatMoney(x.amount, x.currency)}
              </span>
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
        {broken && <span style={{ fontSize: 12, color: "var(--warning)" }}>La imagen no carga</span>}
      </div>
    </button>
  );
}

/** Selector de moneda: las habituales, más la actual si no está en la lista. */
function CurrencySelect({
  value,
  onChange,
  exclude = [],
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  exclude?: string[];
  ariaLabel: string;
}) {
  const options = CURRENCIES.filter((c) => c.code === value || !exclude.includes(c.code));
  return (
    <select style={{ ...input, width: 110, flex: "0 0 auto" }} value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
      {!options.some((c) => c.code === value) && <option value={value}>{value}</option>}
      {options.map((c) => (
        <option key={c.code} value={c.code} title={c.label}>
          {c.code}
        </option>
      ))}
    </select>
  );
}

function ProductDrawer({
  product,
  fields,
  onManageFields,
  onClose,
  onSaved,
}: {
  product: ProductDto | null;
  fields: ProductFieldDto[];
  onManageFields: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !product;
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [currency, setCurrency] = useState(product?.currency ?? "USD");
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  // Valores de los campos personalizados. Se conservan también los de campos
  // borrados para no perderlos si se vuelven a crear.
  const [attributes, setAttributes] = useState<Record<string, string>>(product?.attributes ?? {});
  // Precios en otras monedas (el importe como texto para escribir decimales).
  const [prices, setPrices] = useState<{ currency: string; amount: string }[]>(
    (product?.prices ?? []).map((p) => ({ currency: p.currency, amount: String(p.amount) })),
  );
  const [mounted, setMounted] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);

  const used = [currency, ...prices.map((p) => p.currency)];
  const nextCurrency = CURRENCIES.find((c) => !used.includes(c.code))?.code;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => setPreviewBroken(false), [imageUrl]);

  // Obligatorios que los controles nativos no pueden marcar (Sí/No, varias opciones).
  const missing = fields.filter((f) => f.required && !(attributes[f.key] ?? "").trim());

  const save = useMutation({
    mutationFn: () => {
      const payload: CreateProductInput = {
        name: name.trim(),
        sku: sku.trim() || null,
        price: Number(price) || 0,
        currency,
        prices: prices
          .filter((p) => p.amount.trim() !== "" && p.currency !== currency)
          .map((p) => ({ currency: p.currency, amount: Number(p.amount) || 0 })),
        imageUrl: normalizeUrl(imageUrl),
        description: description.trim() || null,
        isActive,
        attributes,
      };
      return isNew ? createProduct(payload) : updateProduct(product!.id, payload);
    },
    onSuccess: () => {
      toast.success(isNew ? "Producto creado" : "Cambios guardados");
      onSaved();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteProduct(product!.id),
    onSuccess: () => {
      toast.success("Producto eliminado");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!mounted) return null;
  const preview = normalizeUrl(imageUrl);

  return createPortal(
    <>
      <div style={backdrop} onClick={onClose} />
      <aside role="dialog" aria-label={isNew ? "Nuevo producto" : "Editar producto"} style={drawer}>
        <header style={drawerHeader}>
          <strong style={{ fontSize: 16 }}>{isNew ? "Nuevo producto" : "Editar producto"}</strong>
          <button onClick={onClose} style={{ ...ghostBtn, ...smBtn, padding: 7 }} aria-label="Cerrar" title="Cerrar (Esc)">
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <form
          id="product-form"
          style={drawerBody}
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (missing.length) {
              toast.error(`Falta completar: ${missing.map((f) => f.label).join(", ")}`);
              return;
            }
            save.mutate();
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={previewBox}>
              {preview && !previewBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" onError={() => setPreviewBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "var(--muted)", opacity: 0.6 }}>
                  <NavIcon name={previewBroken ? "alert" : "image"} size={24} />
                </span>
              )}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Field text="Nombre">
                <input style={input} value={name} autoFocus required onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field text="SKU" hint="Opcional. Código único para importar y actualizar.">
                <input style={input} value={sku} onChange={(e) => setSku(e.target.value)} />
              </Field>
            </div>
          </div>

          <Field text="Imagen (URL)" hint={previewBroken ? "La URL no devuelve una imagen." : "El agente puede enviar esta foto al cliente."}>
            <input style={input} value={imageUrl} placeholder="https://…" onChange={(e) => setImageUrl(e.target.value)} />
          </Field>

          <Field text="Descripción">
            <textarea
              style={{ ...input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
              value={description}
              placeholder="Qué es, qué incluye, tallas… El agente la usa para responder."
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <section style={section}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Detalles</div>
              <button type="button" onClick={onManageFields} style={{ ...ghostBtn, ...smBtn }}>
                {fields.length ? "Editar campos" : "Añadir campos"}
              </button>
            </div>
            {fields.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
                Añade los datos que necesites: talla o color para productos, duración o
                modalidad para servicios, fecha y cupos para talleres. El agente de IA los
                usa para responder y buscar.
              </div>
            ) : (
              <div className="pf-grid">
                {fields.map((f) => (
                  <Field
                    key={f.id}
                    text={f.required ? `${f.label} *` : f.label}
                    hint={f.help ?? (f.aiVisible ? undefined : "Interno: el agente de IA no lo ve.")}
                    wide={f.type === "longtext" || f.type === "multiselect"}
                  >
                    <ProductFieldInput
                      field={f}
                      style={input}
                      value={attributes[f.key] ?? ""}
                      onChange={(v) => setAttributes((a) => ({ ...a, [f.key]: v }))}
                    />
                  </Field>
                ))}
              </div>
            )}
          </section>

          <section style={section}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Precios</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
              A cada cliente se le cotiza en la moneda de su país (por el prefijo de su
              teléfono). Si no hay precio en su moneda, se le da el precio base.
            </div>

            <div style={priceRow}>
              <span style={priceRowLabel}>Base</span>
              <CurrencySelect value={currency} onChange={setCurrency} exclude={prices.map((p) => p.currency)} ariaLabel="Moneda del precio base" />
              <input
                style={{ ...input, flex: 1 }}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={price}
                placeholder="0.00"
                aria-label="Precio base"
                onChange={(e) => setPrice(e.target.value)}
              />
              <span style={{ width: 34 }} />
            </div>

            {prices.map((row, i) => (
              <div key={i} style={priceRow}>
                <span style={priceRowLabel} />
                <CurrencySelect
                  value={row.currency}
                  exclude={used.filter((c) => c !== row.currency)}
                  ariaLabel={`Moneda ${i + 2}`}
                  onChange={(v) => setPrices((l) => l.map((r, k) => (k === i ? { ...r, currency: v } : r)))}
                />
                <input
                  style={{ ...input, flex: 1 }}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={row.amount}
                  placeholder="0.00"
                  aria-label={`Precio en ${row.currency}`}
                  onChange={(e) => setPrices((l) => l.map((r, k) => (k === i ? { ...r, amount: e.target.value } : r)))}
                />
                <button
                  type="button"
                  onClick={() => setPrices((l) => l.filter((_, k) => k !== i))}
                  style={{ ...ghostBtn, padding: 0, width: 34, height: 38 }}
                  aria-label={`Quitar el precio en ${row.currency}`}
                  title={`Quitar el precio en ${row.currency}`}
                >
                  <NavIcon name="x" size={14} />
                </button>
              </div>
            ))}

            {nextCurrency && (
              <button
                type="button"
                onClick={() => setPrices((l) => [...l, { currency: nextCurrency, amount: "" }])}
                style={{ ...ghostBtn, ...smBtn, alignSelf: "flex-start" }}
              >
                <NavIcon name="plus" size={14} /> Precio en otra moneda
              </button>
            )}
          </section>

          <label style={toggleRow}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>
              <strong style={{ fontSize: 14 }}>Activo</strong>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>
                Los inactivos no aparecen al agente de IA.
              </span>
            </span>
          </label>

          {save.isError && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{(save.error as Error).message}</p>}
        </form>

        <footer style={drawerFooter}>
          {!isNew && (
            <button
              type="button"
              style={dangerBtn}
              disabled={remove.isPending}
              onClick={() => {
                void confirmDialog({ message: `¿Eliminar "${product!.name}"? No se puede deshacer.`, danger: true }).then(
                  (ok) => ok && remove.mutate(),
                );
              }}
            >
              Eliminar
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancelar
          </button>
          <button type="submit" form="product-form" disabled={!name.trim() || save.isPending} style={primaryBtn}>
            {save.isPending ? "Guardando…" : isNew ? "Crear producto" : "Guardar cambios"}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

function Field({ text, hint, wide, children }: { text: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={{ ...label, marginBottom: 0 }}>{text}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

// ── Estilos ───────────────────────────────────────────────────
const page: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: 24 };

const toolbar: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const searchBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  minWidth: 240,
  flex: "0 1 320px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--muted)",
};

const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "9px 0",
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
  boxShadow: "none",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 14,
  marginTop: 18,
};

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: 0,
  textAlign: "left",
  font: "inherit",
  color: "var(--text)",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden",
  cursor: "pointer",
};

const thumb: React.CSSProperties = {
  position: "relative",
  aspectRatio: "4 / 3",
  background: "var(--field)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderBottom: "1px solid var(--border)",
};

const inactiveBadge: React.CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(8, 5, 16, 0.8)",
  border: "1px solid var(--border)",
  color: "var(--muted)",
};

const cardTitle: React.CSSProperties = {
  fontSize: 14.5,
  lineHeight: 1.3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const cardPrice: React.CSSProperties = {
  marginTop: 6,
  fontSize: 18,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};

const priceChips: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 2 };

const priceChip: React.CSSProperties = {
  fontSize: 11.5,
  padding: "2px 7px",
  borderRadius: 999,
  background: "var(--surface-3)",
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums",
};

const empty: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  textAlign: "center",
  padding: "56px 24px",
  marginTop: 18,
  color: "var(--muted)",
  fontSize: 14,
  border: "1px dashed var(--border)",
  borderRadius: 12,
};

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(4, 2, 10, 0.55)",
  zIndex: 1000,
  animation: "fadeIn 0.15s ease",
};

const drawer: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100dvh",
  width: "min(480px, 100vw)",
  background: "var(--panel-2)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "var(--shadow-drawer)",
  zIndex: 1001,
  display: "flex",
  flexDirection: "column",
};

const drawerHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  borderBottom: "1px solid var(--border)",
};

const drawerBody: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 18,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const drawerFooter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 18px",
  borderTop: "1px solid var(--border)",
};

const previewBox: React.CSSProperties = {
  width: 96,
  height: 96,
  flexShrink: 0,
  borderRadius: 10,
  overflow: "hidden",
  background: "var(--field)",
  border: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const section: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 14,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
};

const priceRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };

const priceRowLabel: React.CSSProperties = { width: 36, fontSize: 12, color: "var(--muted)", flexShrink: 0 };

const toggleRow: React.CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" };

/** La moneda que más se repite en el catálogo (USD si está vacío). */
function mostUsedCurrency(products: { currency: string }[]): string {
  const count = new Map<string, number>();
  for (const p of products) count.set(p.currency, (count.get(p.currency) ?? 0) + 1);
  let best = "USD";
  let n = 0;
  for (const [cur, c] of count) if (c > n) [best, n] = [cur, c];
  return best;
}
