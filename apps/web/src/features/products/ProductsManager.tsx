"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavIcon } from "@/components/NavIcons";
import { FiltersToggle } from "@/components/Filters";
import { Pagination } from "@/components/Pagination";
import { DebouncedInput } from "@/components/DebouncedInput";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import {
  CURRENCIES,
  PRODUCT_PAGE_SIZES,
  PRODUCT_SORTS,
  PRODUCT_SORT_LABELS,
  countProductFilters,
  productListQueryToParams,
  type CreateProductInput,
  type ProductBulkAction,
  type ProductDto,
  type ProductFieldDto,
  type ProductSort,
} from "@crm/shared";
import {
  bulkProducts,
  createProduct,
  deleteProduct,
  fetchProductFields,
  fetchProductPage,
  fetchProductSources,
  updateProduct,
} from "@/lib/bff";
import { dangerBtn, ghostBtn, input, label, primaryBtn, smBtn } from "@/components/ui";
import { ImportProductsDialog } from "./ImportProductsDialog";
import { ProductSourceMark, ProductSourcesDialog } from "./ProductSourcesDialog";
import { ProductFieldInput, ProductFieldsDialog } from "./ProductFieldsDialog";
import { ActiveProductFilters, ProductFiltersPanel } from "./ProductFilters";
import { ProductBulkBar, ProductGrid, ProductTable, type ProductView } from "./ProductResults";
import { useProductListUrl } from "./useProductListUrl";

// Al pegar una imagen es fácil olvidar el esquema ("midominio.com/foto.jpg").
// Se añade https:// para que no lo rechace la validación de URL.
function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

const VIEW_KEY = "products.view";

const DONE: Record<ProductBulkAction, [string, string]> = {
  activate: ["activado", "activados"],
  deactivate: ["desactivado", "desactivados"],
  delete: ["eliminado", "eliminados"],
};

const howMany = (n: number) => (n === 1 ? "1 producto" : `${n.toLocaleString("es")} productos`);

export function ProductsManager() {
  const queryClient = useQueryClient();
  const { query, apiQuery, filterQuery, update } = useProductListUrl();
  const [editing, setEditing] = useState<ProductDto | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<ProductView>("grid");
  const resultsRef = useRef<HTMLDivElement>(null);

  // La vuelta desde Mercado Libre: ?stores=mercadolibre&connected=1 o &error=… (el API redirige aquí).
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("stores") !== "mercadolibre") return;
    const error = params.get("error");
    if (error) toast.error(`Mercado Libre: ${error}`);
    else if (params.get("connected")) toast.success("Mercado Libre conectado. Leyendo tus publicaciones…");
    setSourcesOpen(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, [params]);

  // Cuadrícula o tabla: una preferencia de quien mira, no un filtro.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "table") setView(v);
    } catch {
      /* sin almacenamiento: cuadrícula */
    }
  }, []);
  const changeView = (v: ProductView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* nada */
    }
  };

  const { data: fields = [] } = useQuery({ queryKey: ["product-fields"], queryFn: fetchProductFields });

  const { data, isPending, isError, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["products", apiQuery],
    queryFn: () => fetchProductPage(apiQuery),
    // Al cambiar de página o de filtro se queda la lista anterior hasta que llega la nueva: sin parpadeo.
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products"] });

  // Tiendas conectadas: mientras alguna lee su catálogo se consulta seguido y,
  // al terminar, se refrescan los productos y los campos que haya creado.
  const { data: sources = [], isPending: sourcesPending } = useQuery({
    queryKey: ["product-sources"],
    queryFn: fetchProductSources,
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === "running") ? 2500 : false),
  });
  const reading = sources.filter((s) => s.status === "running").length;
  const sourceErrors = sources.filter((s) => s.status === "error").length;
  const wasReading = useRef(false);
  useEffect(() => {
    if (wasReading.current && reading === 0) {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["product-fields"] });
    }
    wasReading.current = reading > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading]);

  // Si la página pedida ya no existe (se borraron productos), el servidor sirve la última: la URL se pone al día.
  useEffect(() => {
    if (data && !isPlaceholderData && data.page !== query.page) update((q) => ({ ...q, page: data.page }), { keepPage: true });
  }, [data, isPlaceholderData, query.page, update]);

  // La página siguiente se pide por adelantado: pasar de página es inmediato.
  useEffect(() => {
    if (!data || isPlaceholderData || data.page * data.pageSize >= data.total) return;
    const next = productListQueryToParams({ ...query, page: data.page + 1 }).toString();
    void queryClient.prefetchQuery({ queryKey: ["products", next], queryFn: () => fetchProductPage(next), staleTime: 30_000 });
  }, [data, isPlaceholderData, query, queryClient]);

  // ── Selección ──────────────────────────────────────────────
  // id → viene de una tienda (para avisar antes de desactivar o borrar).
  const [selected, setSelected] = useState<Map<string, boolean>>(() => new Map());
  const [allMatching, setAllMatching] = useState(false);
  useEffect(() => {
    setSelected(new Map());
    setAllMatching(false);
  }, [filterQuery]);

  const products = data?.data ?? [];
  const total = data?.total ?? 0;
  const shownSelected = useMemo(
    () => (allMatching ? new Set(products.map((p) => p.id)) : new Set(selected.keys())),
    [allMatching, products, selected],
  );
  const pageOn = products.filter((p) => shownSelected.has(p.id)).length;
  const pageChecked: "all" | "some" | "none" = products.length > 0 && pageOn === products.length ? "all" : pageOn > 0 ? "some" : "none";
  const selectedCount = allMatching ? total : selected.size;

  const toggle = (p: ProductDto) => {
    setSelected((m) => {
      const n = allMatching ? new Map(products.map((x) => [x.id, !!x.source] as const)) : new Map(m);
      if (n.has(p.id)) n.delete(p.id);
      else n.set(p.id, !!p.source);
      return n;
    });
    setAllMatching(false);
  };
  const togglePage = () => {
    setSelected((m) => {
      const n = new Map(m);
      if (pageChecked === "all") products.forEach((p) => n.delete(p.id));
      else products.forEach((p) => n.set(p.id, !!p.source));
      return n;
    });
    setAllMatching(false);
  };
  const clearSelection = () => {
    setSelected(new Map());
    setAllMatching(false);
  };

  const bulk = useMutation({
    mutationFn: async (action: ProductBulkAction) => {
      if (allMatching) return bulkProducts({ action, query: filterQuery });
      const ids = [...selected.keys()];
      let count = 0;
      for (let i = 0; i < ids.length; i += 1000) count += (await bulkProducts({ action, ids: ids.slice(i, i + 1000) })).count;
      return { count };
    },
    onSuccess: (r, action) => {
      const [one, many] = DONE[action];
      toast.success(`${howMany(r.count)} ${r.count === 1 ? one : many}`);
      clearSelection();
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const runBulk = (action: ProductBulkAction) => {
    const what = howMany(selectedCount);
    const stores = allMatching ? (data?.fromStores ?? 0) : [...selected.values()].filter(Boolean).length;
    const storesWho = stores === 1 ? "Uno viene" : `${stores.toLocaleString("es")} vienen`;
    if (action === "delete") {
      void confirmDialog({
        title: "Eliminar productos",
        message:
          `Se eliminarán ${what}. No se puede deshacer.` +
          (stores ? ` ${storesWho} de una tienda conectada: si siguen en la tienda, volverán en su próxima lectura.` : ""),
        confirmLabel: "Eliminar",
        danger: true,
      }).then((ok) => ok && bulk.mutate(action));
      return;
    }
    const storeNote = stores ? ` ${storesWho} de una tienda conectada: la tienda vuelve a poner su estado en cada lectura.` : "";
    if (allMatching || stores) {
      void confirmDialog({
        title: action === "activate" ? "Activar productos" : "Desactivar productos",
        message:
          action === "activate"
            ? `Se activarán ${what}: el agente de IA podrá ofrecerlos.${storeNote}`
            : `Se desactivarán ${what}: el agente de IA deja de ofrecerlos.${storeNote}`,
        confirmLabel: action === "activate" ? "Activar" : "Desactivar",
      }).then((ok) => ok && bulk.mutate(action));
      return;
    }
    bulk.mutate(action);
  };

  // ── Navegación ─────────────────────────────────────────────
  const filtersCount = countProductFilters(query);
  const filtering = !!query.q || query.status !== "all" || filtersCount > 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = from ? from + products.length - 1 : 0;

  const goPage = (page: number) => {
    update((q) => ({ ...q, page }), { keepPage: true, push: true });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    resultsRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  };
  const clearAll = () => update((q) => ({ ...q, q: "", status: "all", source: null, price: null, currency: null, fields: {} }));

  return (
    <div style={page}>
      <div style={toolbar}>
        <label className="kb-search prod-search">
          <NavIcon name="search" size={14} />
          <DebouncedInput
            value={query.q}
            onCommit={(v) => update((q) => ({ ...q, q: v.trim() }))}
            placeholder="Buscar por nombre, SKU o campos"
            aria-label="Buscar productos"
            data-product-search
          />
          {query.q && (
            <button type="button" className="prod-search__clear" onClick={() => update((q) => ({ ...q, q: "" }))} aria-label="Limpiar búsqueda">
              <NavIcon name="x" size={12} />
            </button>
          )}
        </label>
        <FiltersToggle open={filtersOpen} count={filtersCount} onClick={() => setFiltersOpen((v) => !v)} />
        <div style={{ flex: 1 }} />
        <button onClick={() => setFieldsOpen(true)} style={ghostBtn} className="prod-tool" title="Los datos que guardas de cada producto, servicio o taller" aria-label="Campos">
          <NavIcon name="tag" size={15} /> <span className="prod-tool__text">Campos{fields.length > 0 ? ` · ${fields.length}` : ""}</span>
        </button>
        <button
          onClick={() => setSourcesOpen(true)}
          style={ghostBtn}
          className="prod-tool"
          data-tour="products-connect"
          title="Conectar WooCommerce, Shopify, Mercado Libre o una hoja de Google"
          aria-label="Tiendas"
        >
          <NavIcon name="store" size={15} /> <span className="prod-tool__text">Tiendas{sources.length > 0 ? ` · ${sources.length}` : ""}</span>
          {reading > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>leyendo…</span>}
          {sourceErrors > 0 && <span style={errorDot} title={`${sourceErrors} con error`} />}
        </button>
        <button onClick={() => setImporting(true)} style={ghostBtn} className="prod-tool" data-tour="products-import" aria-label="Importar" title="Importar desde Excel o CSV">
          <NavIcon name="file" size={15} /> <span className="prod-tool__text">Importar</span>
        </button>
        <button onClick={() => setEditing("new")} style={primaryBtn} data-tour="products-new">
          <NavIcon name="plus" size={15} /> Nuevo producto
        </button>
      </div>

      {filtersOpen && (
        <ProductFiltersPanel query={query} fields={fields} sources={sources} currencies={data?.currencies ?? []} update={update} />
      )}
      <ActiveProductFilters query={query} fields={fields} sources={sources} update={update} onClearAll={clearAll} />

      {fieldsOpen && <ProductFieldsDialog fields={fields} onClose={() => setFieldsOpen(false)} />}
      {sourcesOpen && <ProductSourcesDialog sources={sources} loading={sourcesPending} onClose={() => setSourcesOpen(false)} />}

      {importing && (
        <ImportProductsDialog onClose={() => setImporting(false)} onImported={refresh} suggestedCurrency={data?.currencies[0] ?? "USD"} />
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

      {data && data.catalogTotal > 0 && (
        <div className="prod-bar" ref={resultsRef}>
          <div className="prod-bar__left">
            <div className="seg" role="tablist" aria-label="Filtrar por estado">
              {(
                [
                  ["all", "Todos", data.counts.all],
                  ["active", "Activos", data.counts.active],
                  ["inactive", "Inactivos", data.counts.inactive],
                ] as const
              ).map(([k, text, n]) => (
                <button key={k} role="tab" aria-selected={query.status === k} onClick={() => update((q) => ({ ...q, status: k }))} data-status={k}>
                  {`${text} · ${n.toLocaleString("es")}`}
                </button>
              ))}
            </div>
            <span className="prod-bar__count" aria-live="polite" data-results-count>
              {total === 0 ? "Ningún producto" : `${from.toLocaleString("es")}–${to.toLocaleString("es")} de ${howMany(total)}`}
            </span>
          </div>
          <div className="prod-bar__tools">
            <label className="prod-bar__sort">
              <span>Ordenar</span>
              <select className="field field-sm" value={query.sort} onChange={(e) => update((q) => ({ ...q, sort: e.target.value as ProductSort }))} aria-label="Ordenar productos">
                {PRODUCT_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {PRODUCT_SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg seg-sm" role="tablist" aria-label="Vista">
              <button type="button" role="tab" aria-selected={view === "grid"} onClick={() => changeView("grid")} title="Cuadrícula" aria-label="Cuadrícula">
                <NavIcon name="grid" size={14} />
              </button>
              <button type="button" role="tab" aria-selected={view === "table"} onClick={() => changeView("table")} title="Tabla" aria-label="Tabla" data-view-table>
                <NavIcon name="rows" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {isPending && (
        <div className="prod-grid" style={{ marginTop: 18 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 230 }} />
          ))}
        </div>
      )}
      {isError && <p style={{ color: "var(--danger)" }}>No se pudieron cargar los productos.</p>}

      {data && total === 0 && (
        <div style={empty}>
          <NavIcon name="package" size={32} />
          {data.catalogTotal === 0 && !filtering ? (
            <>
              <strong style={{ color: "var(--text)" }}>Aún no tienes productos</strong>
              <span>Crea el primero, importa tu catálogo desde Excel o CSV, o conecta tu tienda. El agente de IA los usa para dar precios.</span>
            </>
          ) : (
            <>
              <strong style={{ color: "var(--text)" }}>Nada coincide con la búsqueda</strong>
              <span>Prueba con otras palabras o quita algún filtro.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} style={{ marginTop: 4 }}>
                Limpiar filtros
              </button>
            </>
          )}
        </div>
      )}

      <div className="prod-results" data-tour="products-grid" aria-busy={isFetching && isPlaceholderData}>
        {products.length > 0 &&
          (view === "table" ? (
            <ProductTable
              products={products}
              fields={fields}
              selected={shownSelected}
              selecting={selectedCount > 0}
              onToggle={toggle}
              onOpen={(p) => setEditing(p)}
              pageChecked={pageChecked}
              onTogglePage={togglePage}
            />
          ) : (
            <ProductGrid products={products} fields={fields} selected={shownSelected} selecting={selectedCount > 0} onToggle={toggle} onOpen={(p) => setEditing(p)} />
          ))}
      </div>

      {data && total > PRODUCT_PAGE_SIZES[0] && (
        <div className="prod-foot">
          <Pagination page={data.page} pages={pages} onPage={goPage} label="Páginas de productos" />
          <label className="prod-foot__size">
            <span>Mostrar</span>
            <select
              className="field field-sm"
              value={query.pageSize}
              onChange={(e) => update((q) => ({ ...q, pageSize: Number(e.target.value) }))}
              aria-label="Productos por página"
            >
              {PRODUCT_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>por página</span>
          </label>
        </div>
      )}

      {selectedCount > 0 && (
        <ProductBulkBar
          count={selectedCount}
          total={total}
          allMatching={allMatching}
          canSelectAll={!allMatching && pageChecked === "all" && total > selected.size}
          busy={bulk.isPending}
          onSelectAll={() => setAllMatching(true)}
          onClear={clearSelection}
          onRun={runBulk}
        />
      )}
    </div>
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
          {product?.source && (
            <div style={syncNotice}>
              <ProductSourceMark kind={product.source.kind} name={product.source.name} />
              <span>
                Viene de <strong>{product.source.name}</strong>. Nombre, SKU, precio, imagen, descripción y estado se actualizan desde allí en cada
                lectura: si los cambias aquí, se perderán. Tus campos y los precios en otras monedas sí se conservan.
              </span>
            </div>
          )}

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








const errorDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--danger)",
  display: "inline-block",
};

const syncNotice: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  fontSize: 12.5,
  lineHeight: 1.45,
  color: "var(--muted)",
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
  background: "var(--scrim)",
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
