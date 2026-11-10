"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { META_MESSAGING_SCOPES, type AvailableMetaPage, type MetaMessagingChannel, type MetaPageDto } from "@crm/shared";
import { connectMetaPages, fetchAvailableMetaPages, fetchMetaPages, fetchSources, updateMetaPage } from "@/lib/bff";
import { useChannelRouting } from "@/features/whatsapp/ChannelConfigDialog";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID ?? "";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const GRAPH_VERSION = "v24.0";

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

const COPY: Record<
  MetaMessagingChannel,
  { title: string; desc: string; toggle: string; empty: string; where: string }
> = {
  messenger: {
    title: "Messenger",
    desc: "Los mensajes que llegan a tu página de Facebook entran en la bandeja, con el mismo agente de IA, los flujos y el embudo de siempre.",
    toggle: "Recibir en la bandeja los mensajes de Messenger de esta página",
    empty: "Conecta la página de Facebook cuyos mensajes quieres atender desde aquí.",
    where: "Messenger",
  },
  instagram: {
    title: "Instagram",
    desc: "Los mensajes directos de la cuenta profesional de Instagram vinculada a tu página de Facebook entran en la bandeja.",
    toggle: "Recibir en la bandeja los mensajes directos de su Instagram",
    empty: "Conecta la página de Facebook a la que está vinculada tu cuenta profesional de Instagram.",
    where: "Instagram",
  },
};

/**
 * Ajustes › Canales › Messenger / Instagram. Los dos cuelgan de la página de
 * Facebook: la misma conexión que los formularios, con dos permisos más. Por
 * página se enciende el canal y se elige quién lo atiende.
 *
 * `hub`: SaaS. Meta solo arranca su SDK en los dominios listados en la app, así
 * que el login se hace en una ventana del dominio raíz (/connect/meta-login) y
 * el token vuelve aquí por postMessage.
 */
export function MetaMessagingSettings({ kind, hub = false }: { kind: MetaMessagingChannel; hub?: boolean }) {
  const copy = COPY[kind];
  const queryClient = useQueryClient();
  const [sdkReady, setSdkReady] = useState(false);
  const [picker, setPicker] = useState<{ sessionId: string; pages: AvailableMetaPage[] } | null>(null);
  const { data: pages = [], isPending } = useQuery({ queryKey: ["meta-pages"], queryFn: fetchMetaPages });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["meta-pages"] });
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  // SDK de Facebook (el mismo que usan WhatsApp y los formularios). En SaaS no: ver `hub`.
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
  }, [hub]);

  const available = useMutation({
    mutationFn: fetchAvailableMetaPages,
    onSuccess: (r) => setPicker(r),
    onError: (e) => toast.error((e as Error).message),
  });

  const connect = useMutation({
    mutationFn: (input: { sessionId: string; pageIds: string[] }) => connectMetaPages({ ...input, enable: kind }),
    onSuccess: () => {
      setPicker(null);
      toast.success(`${copy.title} conectado.`);
      refresh();
    },
    onError: (e) => {
      // Las páginas quedan conectadas aunque el canal no se haya podido encender.
      toast.error((e as Error).message);
      setPicker(null);
      refresh();
    },
  });

  // El token llega desde la ventana del dominio raíz (solo de ese origen).
  useEffect(() => {
    if (!hub) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== rootOrigin()) return;
      const d = e.data as { type?: string; accessToken?: string } | null;
      if (d?.type === "driony:meta-token" && typeof d.accessToken === "string") available.mutate({ accessToken: d.accessToken });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub]);

  function login() {
    if (hub) {
      const w = window.open(
        `${rootOrigin()}/connect/meta-login?origin=${encodeURIComponent(window.location.origin)}&scopes=messaging`,
        "driony-meta-login",
        "width=720,height=780",
      );
      if (!w) toast.error("No se abrió la ventana de Facebook. Permite las ventanas emergentes e inténtalo de nuevo.");
      return;
    }
    if (!window.FB) return;
    window.FB.login(
      (response: any) => {
        const accessToken = response?.authResponse?.accessToken;
        if (accessToken) available.mutate({ accessToken });
        else toast.error("No se completó el inicio de sesión con Facebook.");
      },
      { scope: META_MESSAGING_SCOPES },
    );
  }

  const webhookUrl = `${API_URL}/api/v1/meta/webhook`;
  const enabled = pages.filter((p) => (kind === "messenger" ? p.messengerEnabled : p.instagramEnabled));

  return (
    <div className="ch-panel">
      <div className="ch-panel__head">
        <div>
          <h4>{copy.title}</h4>
          <p>{copy.desc}</p>
        </div>
        {APP_ID && (
          <button onClick={login} disabled={(!hub && !sdkReady) || available.isPending} className="btn btn-primary btn-sm ch-add" data-meta-login>
            {available.isPending ? "Consultando…" : pages.length ? "Añadir páginas" : "Conectar con Facebook"}
          </button>
        )}
      </div>

      {!APP_ID && (
        <div style={card}>
          <strong>Falta configurar la app de Meta</strong>
          <p style={{ ...muted, marginBottom: 0 }}>
            Define <code>NEXT_PUBLIC_WHATSAPP_APP_ID</code> y reconstruye el frontend. Es la misma app de Meta que usa WhatsApp.
          </p>
        </div>
      )}

      {picker && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
          <strong>Elige las páginas</strong>
          <PagePicker pages={picker.pages} saving={connect.isPending} onCancel={() => setPicker(null)} onConfirm={(pageIds) => connect.mutate({ sessionId: picker.sessionId, pageIds })} />
        </div>
      )}

      {isPending && <p style={muted}>Cargando…</p>}
      {pages.map((p) => (
        <PageRow key={p.id} page={p} kind={kind} onChanged={refresh} />
      ))}
      {!isPending && pages.length === 0 && !picker && (
        <div style={empty}>
          <div style={{ color: "var(--muted)", opacity: 0.6 }}>
            <NavIcon name="message" size={26} />
          </div>
          <p style={{ ...muted, margin: 0 }}>
            <strong style={{ color: "var(--text)" }}>Aún no hay páginas conectadas.</strong>
            <br />
            {copy.empty} Pulsa «Conectar con Facebook».
          </p>
        </div>
      )}
      {!isPending && pages.length > 0 && enabled.length === 0 && !picker && (
        <p style={muted}>Tienes páginas conectadas para los formularios: enciende {copy.where} en la que quieras atender desde la bandeja.</p>
      )}

      <details className="ch-details">
        <summary>
          Cómo funciona <small>· ventana de 24 h, permisos y qué configurar en Meta</small>
        </summary>
        <div className="ch-details__body">
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>
              Cada mensaje entra como una conversación de {copy.where}, con el contacto identificado por su cuenta (sin teléfono hasta que
              te lo dé). El agente de IA, los flujos, el embudo y los avisos funcionan igual que en WhatsApp.
            </li>
            <li>
              <strong>Ventana de 24 h:</strong> puedes escribir libremente hasta 24 horas después del último mensaje del cliente. Después,
              Meta deja que una persona responda hasta 7 días (etiqueta de agente humano, que la app debe tener aprobada); no hay
              plantillas ni difusiones en {copy.where}.
            </li>
            {kind === "instagram" && (
              <li>
                La cuenta de Instagram debe ser <strong>profesional</strong>, estar <strong>vinculada a la página</strong> y tener activado
                «Permitir el acceso a los mensajes» en la app de Instagram: Configuración › Mensajes y respuestas a historias › Controles de
                mensajes › Herramientas conectadas.
              </li>
            )}
            <li>
              En tu app de Meta → Webhooks, con la URL <code style={code}>{webhookUrl}</code> (la misma de los formularios) y el token de
              verificación de WhatsApp: suscribe el objeto <strong>Página</strong> a <code>messages</code>, <code>messaging_postbacks</code>,{" "}
              <code>message_echoes</code>, <code>message_reads</code>, <code>message_deliveries</code>, <code>message_reactions</code> y{" "}
              <code>messaging_referrals</code>
              {kind === "instagram" ? (
                <>
                  ; y el objeto <strong>Instagram</strong> a <code>messages</code>, <code>messaging_postbacks</code>, <code>messaging_seen</code>,{" "}
                  <code>message_reactions</code> y <code>messaging_referral</code>.
                </>
              ) : (
                "."
              )}
            </li>
            <li>
              Permisos: <code>pages_messaging</code>
              {kind === "instagram" && (
                <>
                  , <code>instagram_basic</code> e <code>instagram_manage_messages</code>
                </>
              )}
              , además de los de las páginas. Hasta que Meta los apruebe en la revisión de la app, solo pueden conectar quienes tienen un
              rol en ella (tu propia empresa para probar).
            </li>
          </ul>
        </div>
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
  const [selected, setSelected] = useState<string[]>(pages.filter((p) => p.connected).map((p) => p.pageId));
  return (
    <>
      {pages.map((p) => (
        <label key={p.pageId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={selected.includes(p.pageId)}
            onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, p.pageId] : prev.filter((id) => id !== p.pageId)))}
          />
          {p.name}
          {p.connected && <span style={{ ...muted, fontSize: 12 }}>· ya conectada</span>}
        </label>
      ))}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || selected.length === 0} onClick={() => onConfirm(selected)}>
          {saving ? "Conectando…" : "Conectar"}
        </button>
      </div>
    </>
  );
}

/** Una página: el interruptor del canal y, encendido, quién lo atiende. */
function PageRow({ page, kind, onChanged }: { page: MetaPageDto; kind: MetaMessagingChannel; onChanged: () => void }) {
  const routing = useChannelRouting();
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const copy = COPY[kind];
  const on = kind === "messenger" ? page.messengerEnabled : page.instagramEnabled;
  const sourceId = kind === "messenger" ? page.messengerSourceId : page.instagramSourceId;
  const autoSource = sources.find((s) => s.kind === kind);
  const bot = kind === "messenger" ? page.messengerBot : page.instagramBot;
  const pipelineId = kind === "messenger" ? page.messengerPipelineId : page.instagramPipelineId;
  const bots = routing.bots.filter((b) => b.isActive || b.id === bot?.id);
  const defaultBot = routing.bots.find((b) => b.isDefault);
  const defaultPipeline = routing.pipelines.find((p) => p.isDefault);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateMetaPage>[1]) => updateMetaPage(page.id, input),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });

  const since = page.messagingSubscribedAt ? new Date(page.messagingSubscribedAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }} data-meta-page={page.name}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong>{page.name}</strong>
        {kind === "instagram" && page.instagramUsername && <span style={muted}>@{page.instagramUsername}</span>}
        {!page.isActive && <span style={{ ...muted, color: "var(--warning)" }}>· página desactivada</span>}
      </div>
      <label className="agenda-check">
        <input
          type="checkbox"
          checked={on}
          disabled={save.isPending}
          onChange={(e) => save.mutate(kind === "messenger" ? { messengerEnabled: e.target.checked } : { instagramEnabled: e.target.checked })}
        />
        <span>{save.isPending ? "Guardando…" : copy.toggle}</span>
      </label>
      {page.messagingError && (
        <p style={{ ...muted, color: "var(--warning)", margin: 0 }}>
          <NavIcon name="alert" size={13} /> {page.messagingError}
        </p>
      )}
      {on && (
        <>
          <div style={formRow}>
            <label style={field}>
              <span style={label}>Agente de IA</span>
              <select className="field field-sm" value={bot?.id ?? ""} disabled={save.isPending} onChange={(e) => save.mutate(kind === "messenger" ? { messengerBotId: e.target.value || null } : { instagramBotId: e.target.value || null })}>
                <option value="">{defaultBot ? `${defaultBot.name} (predeterminado)` : "El predeterminado de la empresa"}</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={field}>
              <span style={label}>Fuente de sus contactos</span>
              <select className="field field-sm" value={sourceId ?? ""} disabled={save.isPending} onChange={(e) => save.mutate(kind === "messenger" ? { messengerSourceId: e.target.value || null } : { instagramSourceId: e.target.value || null })}>
                <option value="">{autoSource ? `La automática (${autoSource.name})` : `La automática «${copy.title}»`}</option>
                {sources
                  .filter((s) => !s.kind)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label style={field}>
              <span style={label}>Embudo de entrada</span>
              <select className="field field-sm" value={pipelineId ?? ""} disabled={save.isPending} onChange={(e) => save.mutate(kind === "messenger" ? { messengerPipelineId: e.target.value || null } : { instagramPipelineId: e.target.value || null })}>
                <option value="">{defaultPipeline ? `${defaultPipeline.name} (predeterminado)` : "El predeterminado"}</option>
                {routing.pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ ...muted, margin: 0, fontSize: 12.5 }}>
            {since ? `Recibiendo mensajes desde el ${since}.` : "Recibiendo mensajes."} Lo escrito antes de encenderlo no entra.
          </p>
        </>
      )}
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };
const card: React.CSSProperties = {
  padding: 14,
  border: "1px solid var(--border)",
  background: "var(--panel)",
};
const empty: React.CSSProperties = {
  ...card,
  display: "flex",
  gap: 14,
  alignItems: "center",
};
const formRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: React.CSSProperties = { fontSize: 12.5, color: "var(--muted)", fontWeight: 600 };
const code: React.CSSProperties = { fontSize: 12, wordBreak: "break-all" };
