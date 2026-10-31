"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AvailableMetaPage,
  MetaLeadDto,
  MetaPageDto,
  TemplateDto,
} from "@crm/shared";
import {
  connectMetaPages,
  convertMetaLead,
  disconnectMetaPage,
  discardMetaLead,
  fetchAvailableMetaPages,
  fetchMetaLeads,
  fetchMetaPages,
  fetchSources,
  fetchTags,
  fetchTemplates,
  resubscribeMetaPage,
  updateMetaPage,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID ?? "";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const GRAPH_VERSION = "v24.0";

// Lo que Meta exige para leer formularios: ver las páginas, administrar sus
// webhooks y descargar los leads.
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "leads_retrieval",
  "ads_management",
].join(",");

/** El dominio raíz de la plataforma: este subdominio sin su primera etiqueta (acme.driony.com → driony.com). */
function rootOrigin(): string {
  const host = window.location.host.split(".").slice(1).join(".");
  return `${window.location.protocol}//${host}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

/**
 * `hub`: SaaS. Meta solo arranca su SDK en los dominios listados en la app, así
 * que el login con Facebook se hace en una ventana del dominio raíz
 * (/connect/meta-login) y el código vuelve aquí por postMessage.
 */
export function MetaLeadsSettings({ hub = false }: { hub?: boolean }) {
  const queryClient = useQueryClient();
  const [sdkReady, setSdkReady] = useState(false);
  const [picker, setPicker] = useState<{
    sessionId: string;
    pages: AvailableMetaPage[];
  } | null>(null);

  const { data: pages = [], isPending } = useQuery({
    queryKey: ["meta-pages"],
    queryFn: fetchMetaPages,
  });
  const { data: pending = [] } = useQuery({
    queryKey: ["meta-leads", "NO_PHONE"],
    queryFn: () => fetchMetaLeads("NO_PHONE"),
  });
  const { data: sources = [] } = useQuery({
    queryKey: ["sources"],
    queryFn: fetchSources,
  });
  const { data: tags = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: fetchTemplates,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["meta-pages"] });
    queryClient.invalidateQueries({ queryKey: ["meta-leads"] });
  };

  // SDK de Facebook (el mismo que usa la conexión de WhatsApp). En SaaS no: ver `hub`.
  useEffect(() => {
    if (!APP_ID || hub) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, xfbml: false, version: GRAPH_VERSION });
      setSdkReady(true);
    };
    if (document.getElementById("fb-sdk")) return;
    const s = document.createElement("script");
    s.id = "fb-sdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    document.body.appendChild(s);
  }, []);

  const available = useMutation({
    mutationFn: fetchAvailableMetaPages,
    onSuccess: (r) => setPicker(r),
    onError: (e) => toast.error((e as Error).message),
  });

  const connect = useMutation({
    mutationFn: connectMetaPages,
    onSuccess: (list) => {
      setPicker(null);
      toast.success(`${list.length} página(s) conectada(s).`);
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // El código llega desde la ventana del dominio raíz (solo de ese origen).
  useEffect(() => {
    if (!hub) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== rootOrigin()) return;
      const d = e.data as { type?: string; code?: string; accessToken?: string } | null;
      if (d?.type === "driony:meta-token" && typeof d.accessToken === "string") available.mutate({ accessToken: d.accessToken });
      else if (d?.type === "driony:meta-code" && typeof d.code === "string") available.mutate({ code: d.code });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub]);

  function login() {
    if (hub) {
      const w = window.open(
        `${rootOrigin()}/connect/meta-login?origin=${encodeURIComponent(window.location.origin)}`,
        "driony-meta-login",
        "width=720,height=780",
      );
      if (!w) toast.error("No se abrió la ventana de Facebook. Permite las ventanas emergentes e inténtalo de nuevo.");
      return;
    }
    if (!window.FB) return;
    // Respuesta por defecto del SDK: un token de usuario corto. La API lo
    // comprueba contra la app y lo alarga. (El flujo por código del SDK exige
    // un redirect_uri que no controlamos y Meta lo rechazaba.)
    window.FB.login(
      (response: any) => {
        const accessToken = response?.authResponse?.accessToken;
        if (accessToken) available.mutate({ accessToken });
        else toast.error("No se completó el inicio de sesión con Facebook.");
      },
      { scope: SCOPES },
    );
  }

  const webhookUrl = `${API_URL}/api/v1/meta/webhook`;

  return (
    <div className="ch-panel">
      <div className="ch-panel__head">
        <div>
          <h4>Páginas de Facebook</h4>
          <p>Conecta tus páginas y los leads de sus formularios (Facebook e Instagram) entrarán solos como contactos.</p>
        </div>
        {APP_ID && (
          <button onClick={login} disabled={(!hub && !sdkReady) || available.isPending} className="btn btn-primary btn-sm ch-add" data-meta-login>
            {available.isPending ? "Consultando…" : pages.length ? "Añadir páginas" : "Conectar con Facebook"}
          </button>
        )}
      </div>

      {!APP_ID ? (
        <div style={card}>
          <strong>Falta configurar la app de Meta</strong>
          <p style={{ ...muted, marginBottom: 0 }}>
            Define <code>NEXT_PUBLIC_WHATSAPP_APP_ID</code> y reconstruye el
            frontend. Es la misma app de Meta que usa WhatsApp.
          </p>
        </div>
      ) : null}

      {/* Elegir páginas */}
      {picker && (
        <PagePicker
          pages={picker.pages}
          saving={connect.isPending}
          onCancel={() => setPicker(null)}
          onConfirm={(pageIds) =>
            connect.mutate({ sessionId: picker.sessionId, pageIds })
          }
        />
      )}

      {/* Páginas conectadas */}
      {isPending && <p style={muted}>Cargando…</p>}
      {pages.map((p) => (
        <PageRow
          key={p.id}
          page={p}
          sources={sources}
          tags={tags}
          templates={templates}
          onChanged={refresh}
        />
      ))}
      {!isPending && pages.length === 0 && !picker && (
        <div style={empty}>
          <div style={{ color: "var(--muted)", opacity: 0.6 }}>
            <NavIcon name="target" size={26} />
          </div>
          <p style={{ ...muted, margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Aún no hay páginas conectadas.</strong>
            <br />
            Pulsa «Conectar con Facebook»: Meta te pedirá permiso para ver tus páginas y leer sus leads.
          </p>
        </div>
      )}

      {/* Leads sin teléfono */}
      {pending.length > 0 && (
        <section>
          <h4 style={{ margin: "8px 0 4px" }}>
            Leads sin teléfono ({pending.length})
          </h4>
          <p style={{ ...muted, marginTop: 0 }}>
            El CRM identifica a cada contacto por su teléfono. Estos formularios
            no lo pidieron, así que quedan aquí para que los completes tú.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((lead) => (
              <PendingLeadRow key={lead.id} lead={lead} onChanged={refresh} />
            ))}
          </div>
        </section>
      )}

      {/* Ayuda */}
      <details className="ch-details">
        <summary>
          Configuración avanzada <small>· qué configurar en el panel de Meta</small>
        </summary>
        <ol className="ch-details__body" style={{ margin: 0, paddingLeft: 32 }}>
          <li>
            En tu app → Webhooks, suscribe el objeto <strong>Página</strong> al
            campo <code>leadgen</code>, con esta URL:
            <br />
            <code style={code}>{webhookUrl}</code>
            <br />
            El token de verificación es el mismo que usas en WhatsApp (Ajustes ›
            Integraciones).
          </li>
          <li>
            Los permisos <code>leads_retrieval</code>, <code>pages_show_list</code>,{" "}
            <code>pages_read_engagement</code>, <code>pages_manage_metadata</code> y{" "}
            <code>ads_management</code> necesitan pasar la revisión de Meta para
            usarse con páginas de otros. Con tu propia página y tu usuario
            administrador funciona sin revisión.
          </li>
          <li>
            Para probar sin gastar en anuncios, usa la herramienta de prueba de
            formularios de Meta (Lead Ads Testing Tool).
          </li>
        </ol>
      </details>
    </div>
  );
}

function PagePicker({
  pages,
  saving,
  onCancel,
  onConfirm,
}: {
  pages: AvailableMetaPage[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (pageIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    pages.filter((p) => p.connected).map((p) => p.pageId),
  );

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
      <strong>Elige las páginas que quieres conectar</strong>
      {pages.map((p) => (
        <label key={p.pageId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={selected.includes(p.pageId)}
            onChange={(e) =>
              setSelected((prev) =>
                e.target.checked
                  ? [...prev, p.pageId]
                  : prev.filter((id) => id !== p.pageId),
              )
            }
          />
          {p.name}
          {p.connected && (
            <span style={{ ...muted, fontSize: 12 }}>· ya conectada</span>
          )}
        </label>
      ))}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={ghostBtn}>
          Cancelar
        </button>
        <button
          onClick={() => onConfirm(selected)}
          disabled={selected.length === 0 || saving}
          style={primaryBtn}
        >
          {saving ? "Conectando…" : "Conectar"}
        </button>
      </div>
    </div>
  );
}

function PageRow({
  page,
  sources,
  tags,
  templates,
  onChanged,
}: {
  page: MetaPageDto;
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  templates: TemplateDto[];
  onChanged: () => void;
}) {
  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateMetaPage>[1]) =>
      updateMetaPage(page.id, input),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const resubscribe = useMutation({
    mutationFn: () => resubscribeMetaPage(page.id),
    onSuccess: () => {
      toast.success("Página suscrita.");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectMetaPage(page.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });

  const approved = templates.filter((t) => t.status === "APPROVED");

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong>{page.name}</strong>
        {page.subscribedAt ? (
          <span style={pill("#1f6f46")}>Recibiendo leads</span>
        ) : (
          <span style={pill("#7a5a2a")}>Sin suscribir</span>
        )}
        <span style={{ ...muted, fontSize: 12.5 }}>
          {page.leadCount} lead(s)
          {page.pendingCount > 0 && ` · ${page.pendingCount} sin teléfono`}
        </span>
        <div style={{ flex: 1 }} />
        {!page.subscribedAt && (
          <button
            onClick={() => resubscribe.mutate()}
            disabled={resubscribe.isPending}
            style={ghostBtn}
          >
            Reintentar suscripción
          </button>
        )}
        <button
          onClick={() => {
            void confirmDialog({
              message: `¿Desconectar "${page.name}"? Dejarán de entrar sus leads.`,
              danger: true,
            }).then((ok) => ok && disconnect.mutate());
          }}
          style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
        >
          Desconectar
        </button>
      </div>

      <div style={grid}>
        <label>
          <div style={label}>Fuente que se asigna</div>
          <select
            style={input}
            value={page.sourceId ?? ""}
            onChange={(e) => save.mutate({ sourceId: e.target.value || null })}
          >
            <option value="">Sin fuente</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={label}>Plantilla de bienvenida</div>
          <select
            style={input}
            value={page.welcomeTemplateId ?? ""}
            onChange={(e) =>
              save.mutate({ welcomeTemplateId: e.target.value || null })
            }
          >
            <option value="">No enviar nada</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {approved.length === 0 && (
            <div style={{ ...muted, fontSize: 12 }}>
              Necesitas una plantilla aprobada por Meta.
            </div>
          )}
        </label>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={page.createDeal}
            onChange={(e) => save.mutate({ createDeal: e.target.checked })}
          />
          Crear una oportunidad en el pipeline
        </label>
      </div>

      <div>
        <div style={label}>Etiquetas para estos contactos</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tags.map((t) => {
            const on = page.tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() =>
                  save.mutate({
                    tagIds: on
                      ? page.tagIds.filter((id) => id !== t.id)
                      : [...page.tagIds, t.id],
                  })
                }
                style={{
                  ...ghostBtn,
                  borderColor: on ? "var(--accent)" : "var(--border)",
                  color: on ? "var(--text)" : "var(--muted)",
                  background: on ? "var(--accent-soft)" : "transparent",
                }}
              >
                {t.name}
              </button>
            );
          })}
          {tags.length === 0 && (
            <span style={{ ...muted, fontSize: 12.5 }}>
              No hay etiquetas creadas.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PendingLeadRow({
  lead,
  onChanged,
}: {
  lead: MetaLeadDto;
  onChanged: () => void;
}) {
  const [phone, setPhone] = useState("");

  const convert = useMutation({
    mutationFn: () => convertMetaLead(lead.id, phone.trim()),
    onSuccess: () => {
      toast.success("Contacto creado.");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const discard = useMutation({
    mutationFn: () => discardMetaLead(lead.id),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <strong>{lead.name ?? "Sin nombre"}</strong>
        <div style={{ ...muted, fontSize: 12.5 }}>
          {lead.pageName}
          {lead.formName ? ` · ${lead.formName}` : ""}
          {lead.campaignName ? ` · Campaña: ${lead.campaignName}` : ""}
          {lead.email ? ` · ${lead.email}` : ""}
        </div>
        <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
          {lead.fields
            .map((f) => `${f.name}: ${f.value}`)
            .slice(0, 4)
            .join(" · ")}
        </div>
      </div>
      <input
        style={{ ...input, width: 180 }}
        value={phone}
        placeholder="+51987654321"
        onChange={(e) => setPhone(e.target.value)}
      />
      <button
        onClick={() => convert.mutate()}
        disabled={phone.trim().length < 6 || convert.isPending}
        style={primaryBtn}
      >
        {convert.isPending ? "Creando…" : "Crear contacto"}
      </button>
      <button
        onClick={() => {
          void confirmDialog({ message: "¿Descartar este lead?", danger: true }).then(
            (ok) => ok && discard.mutate(),
          );
        }}
        style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
      >
        Descartar
      </button>
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
};

const empty: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
  textAlign: "center",
  padding: "28px 24px",
  border: "1px dashed var(--border)",
  borderRadius: 12,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
};

const label: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--muted)",
  marginBottom: 4,
};

const input: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13.5,
  width: "100%",
  boxSizing: "border-box",
};

const code: React.CSSProperties = {
  display: "inline-block",
  marginTop: 4,
  padding: "3px 6px",
  background: "var(--field)",
  borderRadius: 6,
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 13px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

function pill(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 9px",
    borderRadius: 999,
    background: bg,
    color: "#e9f1ff",
  };
}
