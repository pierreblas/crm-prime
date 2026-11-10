"use client";

import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CURRENCIES,
  MERCADO_LIBRE_SITES,
  PRODUCT_SOURCE_LABEL,
  PRODUCT_SYNC_INTERVALS,
  type ConnectProductSourceInput,
  type MercadoLibreSiteId,
  type ProductSourceDto,
  type ProductSourceKind,
  type TestProductSourceResult,
} from "@crm/shared";
import {
  createProductSource,
  deleteProductSource,
  fetchMercadoLibreConfig,
  registerProductSourceWebhooks,
  startMercadoLibreConnect,
  syncProductSource,
  testProductSource,
  updateProductSource,
} from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { dangerBtn, ghostBtn, input, primaryBtn, smBtn } from "@/components/ui";

const SHORT: Record<ProductSourceKind, string> = { woocommerce: "Woo", shopify: "Shopify", mercadolibre: "ML", sheet: "Sheets", api: "API" };

/**
 * Productos › Tiendas: las conexiones de catálogo de la empresa (WooCommerce,
 * Shopify, Mercado Libre, una hoja de Google, o un sistema que empuja por la API) con su
 * estado, última lectura y webhook de aviso, y el formulario para conectar
 * otra, que prueba las credenciales antes de guardarlas.
 */
export function ProductSourcesDialog({ sources, loading = false, onClose }: { sources: ProductSourceDto[]; loading?: boolean; onClose: () => void }) {
  // Sin conexiones se abre directamente el formulario; mientras cargan, la lista espera.
  const [adding, setAdding] = useState<boolean | null>(null);
  const showAdd = adding ?? (!loading && sources.length === 0);

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog" style={{ width: "min(720px, calc(100vw - 32px))", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 4px" }}>Tiendas conectadas</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              Driony lee tu catálogo solo, cada cierto tiempo o cuando la tienda avisa: precios, fotos, stock y variantes. La tienda manda sobre esos
              datos; tus campos y los precios en otras monedas se conservan.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, ...smBtn, padding: 7 }} aria-label="Cerrar">
            <NavIcon name="x" size={16} />
          </button>
        </div>

        {showAdd ? (
          <ConnectForm onDone={() => setAdding(false)} onCancel={sources.length ? () => setAdding(false) : onClose} />
        ) : (
          <>
            <div className="src-section" style={{ marginTop: 16 }}>
              {loading && <p className="src-empty">Cargando…</p>}
              {sources.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button type="button" onClick={() => setAdding(true)} style={primaryBtn}>
                <NavIcon name="plus" size={14} /> Conectar otra
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Etiqueta pequeña con la conexión de la que viene un producto. */
export function ProductSourceMark({ kind, name, style }: { kind: string; name?: string; style?: CSSProperties }) {
  const k = (kind in SHORT ? kind : "sheet") as ProductSourceKind;
  return (
    <span style={{ ...mark, ...style }} title={name ? `Viene de ${PRODUCT_SOURCE_LABEL[k]} · ${name}` : PRODUCT_SOURCE_LABEL[k]}>
      <NavIcon name={k === "sheet" ? "file" : k === "api" ? "plug" : "store"} size={11} />
      {SHORT[k]}
    </span>
  );
}

// ── Una conexión ─────────────────────────────────────────────

function SourceRow({ source: s }: { source: ProductSourceDto }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["product-sources"] });
  const [removing, setRemoving] = useState(false);
  const isApi = s.kind === "api";

  const update = useMutation({
    mutationFn: (input: Parameters<typeof updateProductSource>[1]) => updateProductSource(s.id, input),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const sync = useMutation({
    mutationFn: () => syncProductSource(s.id),
    onSuccess: (r) => {
      if (r.queued) toast.success("Leyendo el catálogo…");
      else toast.error(r.reason ?? "No se pudo iniciar la lectura");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (mode: "keep" | "delete") => deleteProductSource(s.id, mode),
    onSuccess: (_r, mode) => {
      toast.success(mode === "delete" ? "Conexión y productos eliminados" : "Conexión eliminada; los productos se quedan");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const running = s.status === "running";
  const summary = s.lastSummary;
  const changes = summary
    ? [summary.created && `${summary.created} nuevos`, summary.updated && `${summary.updated} cambios`, summary.deactivated && `${summary.deactivated} desactivados`]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className="src-row" data-source={s.name} style={{ alignItems: "start" }}>
      <ProductSourceMark kind={s.kind} style={{ marginTop: 3 }} />
      <div className="src-row__main">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="src-row__name" style={{ fontWeight: 600 }}>
            {s.name}
          </span>
          {!s.isActive && <span className="src-chip">En pausa</span>}
          {s.credentialsHint && (
            <span className="src-chip" title="Credencial guardada (cifrada)">
              <NavIcon name="key" size={11} />
              {s.credentialsHint}
            </span>
          )}
        </div>
        <div className="src-row__meta">
          {isApi ? (
            <span>Clave de API «{s.target}»</span>
          ) : s.kind === "mercadolibre" ? (
            <span title={`Usuario ${s.target}`}>Cuenta de vendedor</span>
          ) : (
            <span title={s.target}>{hostOf(s.target)}</span>
          )}
          <span>·</span>
          <span>
            {s.productCount} producto{s.productCount === 1 ? "" : "s"}
          </span>
          {s.defaultCurrency && (
            <>
              <span>·</span>
              <span>{s.defaultCurrency}</span>
            </>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: s.status === "error" ? "var(--danger)" : "var(--muted)", lineHeight: 1.45 }}>
          {running ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <NavIcon name="hourglass" size={12} /> Leyendo el catálogo…
            </span>
          ) : s.status === "error" ? (
            <>
              <NavIcon name="alert" size={12} /> {s.lastError ?? "La última lectura falló"}
              {s.lastSyncAt && <span style={{ color: "var(--muted)" }}> · última lectura correcta {ago(s.lastSyncAt)}</span>}
            </>
          ) : s.lastSyncAt ? (
            <>
              {isApi ? "Último envío" : "Actualizado"} {ago(s.lastSyncAt)}
              {changes && ` · ${changes}`}
              {summary?.warnings.length ? ` · ${summary.warnings.length} aviso${summary.warnings.length === 1 ? "" : "s"}` : ""}
              {!isApi && s.isActive && s.syncEvery > 0 && s.nextSyncAt && <span> · siguiente {inTime(s.nextSyncAt)}</span>}
            </>
          ) : isApi ? (
            "Aún no ha recibido productos: tu sistema los envía con la API (PUT /api/public/v1/products/bulk)."
          ) : (
            "Pendiente de la primera lectura"
          )}
        </div>
        {!running && summary && summary.warnings.length > 0 && (
          <details style={{ fontSize: 12.5, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer" }}>Ver avisos de la última {isApi ? "carga" : "lectura"}</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
              {summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        {!isApi && <WebhookInfo source={s} />}
        {removing && (
          <div style={removeBox}>
            <span style={{ fontSize: 13 }}>
              ¿Quitar «{s.name}»? Tiene {s.productCount} producto{s.productCount === 1 ? "" : "s"} en el catálogo.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={{ ...ghostBtn, ...smBtn }} disabled={remove.isPending} onClick={() => remove.mutate("keep")}>
                Quitar y conservar los productos
              </button>
              <button type="button" style={{ ...dangerBtn, ...smBtn }} disabled={remove.isPending} onClick={() => remove.mutate("delete")}>
                Quitar y borrar sus productos
              </button>
              <button type="button" style={{ ...ghostBtn, ...smBtn }} onClick={() => setRemoving(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="src-row__actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
        {!isApi && (
          <select
            className="field field-sm"
            style={{ width: "auto" }}
            value={s.syncEvery}
            aria-label="Cada cuánto se lee"
            disabled={update.isPending}
            onChange={(e) => update.mutate({ syncEvery: Number(e.target.value) })}
          >
            {PRODUCT_SYNC_INTERVALS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
            {!PRODUCT_SYNC_INTERVALS.some((o) => o.minutes === s.syncEvery) && <option value={s.syncEvery}>Cada {s.syncEvery} min</option>}
          </select>
        )}
        {!isApi && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={running || sync.isPending || !s.isActive} onClick={() => sync.mutate()} title="Leer el catálogo ahora">
            Leer ahora
          </button>
        )}
        {!isApi && (
          <button
            type="button"
            className="cp-iconbtn"
            onClick={() => update.mutate({ isActive: !s.isActive })}
            disabled={update.isPending}
            title={s.isActive ? "Pausar: deja de leerse hasta que la reanudes" : "Reanudar"}
            aria-label={s.isActive ? `Pausar ${s.name}` : `Reanudar ${s.name}`}
          >
            <NavIcon name={s.isActive ? "pause" : "play"} size={13} />
          </button>
        )}
        <button type="button" className="cp-iconbtn is-danger" onClick={() => setRemoving((v) => !v)} title="Quitar la conexión" aria-label={`Quitar ${s.name}`}>
          <NavIcon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * El webhook de aviso de la conexión: registrado en la tienda, pendiente de
 * crear a mano (con los datos para hacerlo), o la URL para que un script
 * relea una hoja al instante.
 */
function WebhookInfo({ source: s }: { source: ProductSourceDto }) {
  const queryClient = useQueryClient();
  const isStore = s.kind === "woocommerce" || s.kind === "shopify";
  const register = useMutation({
    mutationFn: () => registerProductSourceWebhooks(s.id),
    onSuccess: (r) => {
      if (r.webhookError) toast.error(r.webhookError);
      else toast.success("Webhooks registrados en la tienda");
      queryClient.invalidateQueries({ queryKey: ["product-sources"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (s.kind === "mercadolibre") {
    return (
      <div style={hint}>
        <NavIcon name="zap" size={12} /> Avisos al instante: Mercado Libre avisa de cada cambio en tus publicaciones
        {s.lastWebhookAt ? ` (último aviso ${ago(s.lastWebhookAt)})` : ""}.
      </div>
    );
  }
  if (!s.webhookUrl) {
    return isStore ? <div style={hint}>{s.webhookError ?? "Sin dirección pública: los avisos de la tienda no pueden llegar; se lee por horario."}</div> : null;
  }
  if (isStore && s.webhookRegisteredAt) {
    return (
      <div style={hint}>
        <NavIcon name="zap" size={12} /> Avisos al instante: la tienda avisa de cada cambio (registrado {ago(s.webhookRegisteredAt)}
        {s.lastWebhookAt ? ` · último aviso ${ago(s.lastWebhookAt)}` : ""}).
      </div>
    );
  }
  return (
    <details style={hint}>
      <summary style={{ cursor: "pointer" }}>
        {isStore ? (
          <>
            <NavIcon name="alert" size={12} /> Avisos al instante: pendientes de crear en la tienda
          </>
        ) : (
          "Lectura al instante (opcional)"
        )}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {isStore && s.webhookError && <span style={{ color: "var(--warning)" }}>{s.webhookError}</span>}
        {s.kind === "woocommerce" && (
          <span>
            En WordPress: WooCommerce › Ajustes › Avanzado › Webhooks › Añadir webhook. Estado «Activo», tema «Producto actualizado» (y otro para creado y
            eliminado), y estos datos:
          </span>
        )}
        {s.kind === "shopify" && (
          <span>En Shopify: Configuración › Notificaciones › Webhooks › Crear webhook. Eventos de producto (creación, actualización, eliminación), formato JSON y esta URL:</span>
        )}
        {s.kind === "sheet" && (
          <span>Google no avisa de los cambios. Si quieres que la hoja se relea al momento, llama con POST a esta URL desde un Apps Script (onEdit), Zapier o Make:</span>
        )}
        <CopyRow label="URL de entrega" value={s.webhookUrl} />
        {s.webhookSecret && <CopyRow label="Secreto" value={s.webhookSecret} />}
        {isStore && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} disabled={register.isPending} onClick={() => register.mutate()}>
            {register.isPending ? "Registrando…" : "Registrar de nuevo"}
          </button>
        )}
        {s.lastWebhookAt && <span>Último aviso recibido {ago(s.lastWebhookAt)}.</span>}
      </div>
    </details>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)", minWidth: 96 }}>{label}</span>
      <code style={code}>{value}</code>
      <button
        type="button"
        className="cp-iconbtn"
        title="Copiar"
        aria-label={`Copiar ${label}`}
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => toast.success("Copiado"),
            () => toast.error("No se pudo copiar"),
          )
        }
      >
        <NavIcon name="copy" size={13} />
      </button>
    </div>
  );
}

// ── Conectar otra ────────────────────────────────────────────

type ShopifyMode = "token" | "app";

function ConnectForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ProductSourceKind | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [shopifyMode, setShopifyMode] = useState<ShopifyMode>("app");
  const [accessToken, setAccessToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("PEN");
  const [syncEvery, setSyncEvery] = useState(60);
  const [tested, setTested] = useState<TestProductSourceResult | null>(null);

  function payload(): ConnectProductSourceInput | null {
    const common = { name: name.trim() || undefined, syncEvery };
    if (kind === "woocommerce") {
      if (!url.trim() || !consumerKey.trim() || !consumerSecret.trim()) return null;
      return { kind, url: url.trim(), consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim(), ...common };
    }
    if (kind === "shopify") {
      if (!url.trim()) return null;
      if (shopifyMode === "token") return accessToken.trim() ? { kind, shop: url.trim(), accessToken: accessToken.trim(), ...common } : null;
      return clientId.trim() && clientSecret.trim() ? { kind, shop: url.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim(), ...common } : null;
    }
    if (kind === "sheet") return url.trim() ? { kind, url: url.trim(), defaultCurrency, ...common } : null;
    return null;
  }
  const ready = payload() !== null;

  const test = useMutation({
    mutationFn: () => testProductSource(payload()!),
    onSuccess: setTested,
    onError: (e) => {
      setTested(null);
      toast.error((e as Error).message);
    },
  });
  const create = useMutation({
    mutationFn: () => createProductSource(payload()!),
    onSuccess: () => {
      toast.success("Tienda conectada. Leyendo el catálogo…");
      queryClient.invalidateQueries({ queryKey: ["product-sources"] });
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!kind) {
    return (
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>¿De dónde viene tu catálogo?</div>
        <div style={pickGrid}>
          <KindButton kind="woocommerce" title="WooCommerce" body="Tu tienda en WordPress. Hacen falta una clave de cliente y su clave secreta." onClick={() => setKind("woocommerce")} />
          <KindButton kind="shopify" title="Shopify" body="Tu tienda .myshopify.com, con el token de una app o el ID y secreto de cliente." onClick={() => setKind("shopify")} />
          <KindButton kind="mercadolibre" title="Mercado Libre" body="Tus publicaciones de vendedor. Autorizas en Mercado Libre y Driony las lee; cada variación es un producto." onClick={() => setKind("mercadolibre")} />
          <KindButton kind="sheet" title="Google Sheets o CSV" body="Una hoja compartida por enlace. Las mismas columnas que el importador de archivos." onClick={() => setKind("sheet")} />
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
          ¿Un ERP, un punto de venta o un n8n? Que envíe los productos por la <a href="/docs/api" target="_blank" rel="noreferrer">API</a> con una clave con permiso{" "}
          <code>products:write</code>: la conexión aparecerá aquí sola. ¿Otra plataforma (Tiendanube, VTEX…)? Exporta el catálogo a Excel y usa «Importar», o mantén
          una hoja de Google con tus productos y conéctala aquí.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={ghostBtn}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (kind === "mercadolibre") return <MercadoLibreConnect onBack={() => setKind(null)} onCancel={onCancel} />;

  const label = PRODUCT_SOURCE_LABEL[kind];
  return (
    <form
      style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) create.mutate();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => setKind(null)} style={{ ...ghostBtn, ...smBtn, padding: 6 }} aria-label="Elegir otra plataforma" title="Elegir otra plataforma">
          <NavIcon name="arrow-left" size={14} />
        </button>
        <ProductSourceMark kind={kind} />
        <strong style={{ fontSize: 15 }}>Conectar {label}</strong>
      </div>

      {kind === "woocommerce" && (
        <>
          <Help>
            En WordPress: <b>WooCommerce › Ajustes › Avanzado › REST API › Añadir clave</b>. Con permisos de <b>Lectura/Escritura</b> Driony registra solo los
            avisos de cambios; con <b>Lectura</b> basta para leer el catálogo. Copia las dos claves ahí mismo: la secreta solo se muestra una vez. La tienda
            debe ir por https.
          </Help>
          <Field text="Dirección de la tienda">
            <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mitienda.com" autoFocus required />
          </Field>
          <div style={two}>
            <Field text="Clave de cliente">
              <input style={input} value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder="ck_…" autoComplete="off" required />
            </Field>
            <Field text="Clave secreta">
              <input style={input} type="password" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} placeholder="cs_…" autoComplete="new-password" required />
            </Field>
          </div>
        </>
      )}

      {kind === "shopify" && (
        <>
          <Field text="Dominio de la tienda" hint="El .myshopify.com (en Shopify: Configuración › Dominios), no tu dominio propio.">
            <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="mitienda.myshopify.com" autoFocus required />
          </Field>
          <div className="seg" role="tablist" aria-label="Tipo de credencial" style={{ alignSelf: "flex-start" }}>
            <button type="button" role="tab" aria-selected={shopifyMode === "app"} onClick={() => setShopifyMode("app")}>
              ID y secreto de cliente
            </button>
            <button type="button" role="tab" aria-selected={shopifyMode === "token"} onClick={() => setShopifyMode("token")}>
              Token de acceso
            </button>
          </div>
          {shopifyMode === "app" ? (
            <>
              <Help>
                Crea una app en el <b>Dev Dashboard</b> de Shopify (la misma organización que tu tienda), dale el permiso <b>read_products</b>, instálala
                en la tienda y copia su <b>ID de cliente</b> y <b>secreto de cliente</b>. Driony pide el token por ti, lo renueva solo y registra los avisos de
                cambios.
              </Help>
              <div style={two}>
                <Field text="ID de cliente">
                  <input style={input} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required />
                </Field>
                <Field text="Secreto de cliente">
                  <input style={input} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" required />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Help>
                Para apps creadas desde el panel de la tienda (Configuración › Apps y canales de venta › Desarrollar apps) con el permiso{" "}
                <b>read_products</b>: pega su <b>token de acceso de la API Admin</b> (shpat_…). Desde 2026 Shopify ya no deja crear apps nuevas ahí; las
                que existen siguen funcionando.
              </Help>
              <Field text="Token de acceso">
                <input style={input} type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="shpat_…" autoComplete="new-password" required />
              </Field>
            </>
          )}
        </>
      )}

      {kind === "sheet" && (
        <>
          <Help>
            Comparte la hoja con <b>Cualquier persona con el enlace</b> (Lector) y pega su enlace; también vale el de «Publicar en la web» o cualquier
            CSV público. Primera fila: títulos. Se entienden <b>nombre, precio, moneda, sku, descripción, imagen, activo</b>, columnas{" "}
            <b>precio_USD</b> (precio en otra moneda) y tus campos de producto por su nombre.
          </Help>
          <Field text="Enlace de la hoja">
            <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoFocus required />
          </Field>
          <Field text="Moneda si una fila no la indica">
            <select style={{ ...input, width: "auto" }} value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <div style={two}>
        <Field text="Nombre en Driony" hint="Opcional: si no, el de la tienda.">
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "sheet" ? "Hoja de productos" : "Mi tienda"} />
        </Field>
        <Field text="Cada cuánto se lee" hint={kind === "sheet" ? undefined : "Además, la tienda avisa al instante de cada cambio."}>
          <select style={input} value={syncEvery} onChange={(e) => setSyncEvery(Number(e.target.value))}>
            {PRODUCT_SYNC_INTERVALS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {tested && (
        <div style={okBox}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, flexWrap: "wrap" }}>
            <NavIcon name="check" size={14} /> Conexión correcta
            {tested.name && <span style={{ fontWeight: 500 }}>· {tested.name}</span>}
            {tested.count !== null && (
              <span style={{ fontWeight: 500 }}>
                · {tested.count} producto{tested.count === 1 ? "" : "s"}
              </span>
            )}
            {tested.currency && <span style={{ fontWeight: 500 }}>· {tested.currency}</span>}
          </div>
          {tested.sample.length > 0 && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Por ejemplo: {tested.sample.join(" · ")}</div>}
          {tested.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12.5, color: "var(--warning)" }}>
              <NavIcon name="alert" size={12} /> {w}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          Cancelar
        </button>
        <button type="button" onClick={() => test.mutate()} disabled={!ready || test.isPending} style={ghostBtn}>
          {test.isPending ? "Probando…" : "Probar conexión"}
        </button>
        <button type="submit" disabled={!ready || create.isPending} style={primaryBtn}>
          {create.isPending ? "Conectando…" : "Conectar y leer el catálogo"}
        </button>
      </div>
    </form>
  );
}

/**
 * Mercado Libre no pide credenciales: se elige el país de la cuenta y se
 * autoriza en su web; Mercado Libre devuelve a Productos › Tiendas con la
 * cuenta conectada (o con el motivo si no).
 */
function MercadoLibreConnect({ onBack, onCancel }: { onBack: () => void; onCancel: () => void }) {
  const { data: config, isPending } = useQuery({ queryKey: ["mercadolibre-config"], queryFn: fetchMercadoLibreConfig });
  const [site, setSite] = useState<MercadoLibreSiteId>("MPE");
  const [syncEvery, setSyncEvery] = useState(60);
  const start = useMutation({
    mutationFn: () => startMercadoLibreConnect({ site, syncEvery }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error((e as Error).message),
  });
  const unavailable = !isPending && config?.configured === false;

  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }} data-mercadolibre-form>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={onBack} style={{ ...ghostBtn, ...smBtn, padding: 6 }} aria-label="Elegir otra plataforma" title="Elegir otra plataforma">
          <NavIcon name="arrow-left" size={14} />
        </button>
        <ProductSourceMark kind="mercadolibre" />
        <strong style={{ fontSize: 15 }}>Conectar Mercado Libre</strong>
      </div>
      <Help>
        Se abre Mercado Libre para que autorices a Driony a <b>leer tus publicaciones</b> con tu cuenta de vendedor; no se publica ni se cambia
        nada allí. Vuelves aquí con la cuenta conectada. Se leen las publicaciones activas y las pausadas (estas quedan inactivas); cada variación
        es un producto en Driony, con su stock, el enlace a la publicación, la categoría y la marca. Mercado Libre avisa de cada cambio y se relee
        al momento.
      </Help>
      {unavailable && (
        <div style={{ ...help, color: "var(--warning)" }}>
          Esta instalación no tiene configurada la app de Mercado Libre (MERCADOLIBRE_APP_ID y MERCADOLIBRE_APP_SECRET en el servidor). Pídeselo a
          quien administra Driony.
        </div>
      )}
      <div style={two}>
        <Field text="País de tu cuenta" hint="El sitio de Mercado Libre en el que vendes.">
          <select style={input} value={site} onChange={(e) => setSite(e.target.value as MercadoLibreSiteId)}>
            {MERCADO_LIBRE_SITES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.country} · {o.currency}
              </option>
            ))}
          </select>
        </Field>
        <Field text="Cada cuánto se lee" hint="Además, Mercado Libre avisa al instante de cada cambio.">
          <select style={input} value={syncEvery} onChange={(e) => setSyncEvery(Number(e.target.value))}>
            {PRODUCT_SYNC_INTERVALS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          Cancelar
        </button>
        <button type="button" onClick={() => start.mutate()} disabled={start.isPending || isPending || unavailable} style={primaryBtn} data-mercadolibre-connect>
          {start.isPending ? "Abriendo Mercado Libre…" : "Continuar en Mercado Libre"}
        </button>
      </div>
    </div>
  );
}

function KindButton({ kind, title, body, onClick }: { kind: ProductSourceKind; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={pick} className="psrc-pick">
      <ProductSourceMark kind={kind} />
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <span style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{body}</span>
    </button>
  );
}

function Field({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, flex: 1 }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>{text}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return <p style={help}>{children}</p>;
}

// ── Tiempo ───────────────────────────────────────────────────

function ago(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.round(diff / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

function inTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 60_000) return "en breve";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `en ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `en ${h} h` : `en ${Math.round(h / 24)} d`;
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Estilos ──────────────────────────────────────────────────

const mark: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 7px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.4,
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  whiteSpace: "nowrap",
};

const pickGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 };

const pick: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  padding: 14,
  textAlign: "left",
  font: "inherit",
  color: "var(--text)",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  cursor: "pointer",
};

const two: CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };

const help: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--muted)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

const hint: CSSProperties = { fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 };

const code: CSSProperties = {
  fontSize: 12,
  padding: "2px 6px",
  background: "var(--surface-3)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  wordBreak: "break-all",
  maxWidth: "100%",
};

const okBox: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--positive)",
  fontSize: 13,
};

const removeBox: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 6,
  padding: "10px 12px",
  border: "1px solid var(--danger-border)",
  borderRadius: 8,
  background: "rgba(240, 138, 138, 0.08)",
};
