"use client";

import { readableInk } from "@/lib/readable-ink";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AvailableMetaPage,
  MetaFormRule,
  MetaLeadDto,
  MetaLeadFormDto,
  MetaPageDto,
  MetaSessionFormsResult,
  StageRef,
  TemplateDto,
  UpdateMetaPageInput,
} from "@crm/shared";
import { META_FORM_SOURCE_NAME, META_LEADS_SCOPES } from "@crm/shared";
import {
  connectMetaPages,
  convertMetaLead,
  disconnectMetaPage,
  discardMetaLead,
  fetchAvailableMetaPages,
  fetchMetaLeads,
  fetchMetaPageForms,
  fetchMetaPages,
  fetchMetaSessionForms,
  fetchSources,
  fetchStages,
  fetchTags,
  fetchTemplates,
  resubscribeMetaPage,
  updateMetaPage,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { MetaFormDialog } from "./MetaFormDialog";

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID ?? "";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const GRAPH_VERSION = "v24.0";

// Lo que Meta exige para leer formularios (META_LEADS_SCOPES en @crm/shared).
const SCOPES = META_LEADS_SCOPES;

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
  const { data: stages = [] } = useQuery({ queryKey: ["stages"], queryFn: fetchStages });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["meta-pages"] });
    queryClient.invalidateQueries({ queryKey: ["meta-leads"] });
    queryClient.invalidateQueries({ queryKey: ["meta-forms"] });
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
          sessionId={picker.sessionId}
          pages={picker.pages}
          saving={connect.isPending}
          onCancel={() => setPicker(null)}
          onConfirm={(input) => connect.mutate({ sessionId: picker.sessionId, ...input })}
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
          stages={stages}
          onChanged={refresh}
          onReauthorize={login}
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
            <code>pages_read_engagement</code>, <code>pages_manage_metadata</code>,{" "}
            <code>pages_manage_ads</code> (para listar los formularios) y{" "}
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

/**
 * Conectar en dos pasos: las páginas y, de cada una, qué formularios entran.
 * Si Meta no deja listar los formularios de una página, se avisa y entra con
 * todos (se apagan después desde la lista, conforme traigan leads).
 */
function PagePicker({
  sessionId,
  pages,
  saving,
  onCancel,
  onConfirm,
}: {
  sessionId: string;
  pages: AvailableMetaPage[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (input: { pageIds: string[]; forms?: { pageId: string; formIds: string[] }[]; newFormsEnter?: boolean }) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    pages.filter((p) => p.connected).map((p) => p.pageId),
  );
  const [step, setStep] = useState<MetaSessionFormsResult | null>(null);
  // Por página, los formularios marcados.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [newFormsEnter, setNewFormsEnter] = useState(true);
  const forms = useMutation({
    mutationFn: () => fetchMetaSessionForms({ sessionId, pageIds: selected }),
    onSuccess: (r) => {
      setStep(r);
      setPicked(Object.fromEntries(r.pages.map((p) => [p.pageId, p.forms.filter((f) => f.enabled).map((f) => f.formId)])));
      // Una página ya conectada que dejaba esperar a los nuevos lo sigue haciendo.
      setNewFormsEnter(!r.pages.some((p) => p.connected && !p.newFormsEnter));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = (pageId: string, formId: string, on: boolean) =>
    setPicked((prev) => ({ ...prev, [pageId]: on ? [...(prev[pageId] ?? []), formId] : (prev[pageId] ?? []).filter((id) => id !== formId) }));

  if (step) {
    const listable = step.pages.filter((p) => p.fromMeta);
    return (
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }} data-meta-forms-step>
        <strong>Elige los formularios que entran</strong>
        <p style={{ ...muted, fontSize: 13, margin: 0 }}>
          Los que dejes sin marcar quedan apagados: sus leads no entran. Después puedes cambiarlo formulario por formulario.
        </p>
        {step.pages.map((p) => (
          <div key={p.pageId} style={{ display: "flex", flexDirection: "column", gap: 6 }} data-pick-page={p.pageId}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13.5 }}>{p.name}</strong>
              {p.connected && <span style={{ ...muted, fontSize: 12 }}>ya conectada</span>}
              {p.fromMeta && p.forms.length > 1 && (
                <>
                  <button type="button" className="cfe__link" onClick={() => setPicked((prev) => ({ ...prev, [p.pageId]: p.forms.map((f) => f.formId) }))}>
                    todos
                  </button>
                  <button type="button" className="cfe__link" onClick={() => setPicked((prev) => ({ ...prev, [p.pageId]: [] }))}>
                    ninguno
                  </button>
                </>
              )}
            </div>
            {!p.fromMeta && (
              <p style={{ ...muted, fontSize: 12.5, margin: 0 }}>
                Meta no dejó leer los formularios de esta página con los permisos que diste: entrarán todos, y podrás apagar los que no quieras desde la lista conforme traigan leads.
              </p>
            )}
            {p.fromMeta && p.forms.length === 0 && (
              <p style={{ ...muted, fontSize: 12.5, margin: 0 }}>Esta página aún no tiene formularios de clientes potenciales.</p>
            )}
            {p.forms.map((f) => (
              <label key={f.formId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }} data-pick-form={f.formId}>
                <input type="checkbox" checked={(picked[p.pageId] ?? []).includes(f.formId)} onChange={(e) => toggle(p.pageId, f.formId, e.target.checked)} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.formName}</span>
                {f.status === "ARCHIVED" && <span style={pill("#3f5b6b")}>Archivado</span>}
                {f.leadCount > 0 && (
                  <span style={{ ...muted, fontSize: 12 }}>
                    {f.leadCount} lead{f.leadCount === 1 ? "" : "s"}
                  </span>
                )}
              </label>
            ))}
          </div>
        ))}
        {listable.length > 0 && (
          <label>
            <div style={label}>Formularios que crees más adelante</div>
            <select style={{ ...input, maxWidth: 420 }} value={newFormsEnter ? "enter" : "wait"} onChange={(e) => setNewFormsEnter(e.target.value === "enter")} data-new-forms>
              <option value="enter">Entran solos, como la página (recomendado)</option>
              <option value="wait">Esperan a que los actives en la lista</option>
            </select>
          </label>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => setStep(null)} style={ghostBtn} disabled={saving}>
            Atrás
          </button>
          <button
            onClick={() => onConfirm({ pageIds: selected, forms: listable.map((p) => ({ pageId: p.pageId, formIds: picked[p.pageId] ?? [] })), newFormsEnter })}
            disabled={saving}
            style={primaryBtn}
            data-connect
          >
            {saving ? "Conectando…" : "Conectar"}
          </button>
        </div>
      </div>
    );
  }

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
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        {forms.isError && (
          <button type="button" className="cfe__link" onClick={() => onConfirm({ pageIds: selected })} disabled={selected.length === 0 || saving}>
            Conectar sin elegir formularios
          </button>
        )}
        <button onClick={onCancel} style={ghostBtn}>
          Cancelar
        </button>
        <button onClick={() => forms.mutate()} disabled={selected.length === 0 || saving || forms.isPending} style={primaryBtn} data-next>
          {forms.isPending ? "Leyendo formularios…" : "Siguiente"}
        </button>
      </div>
    </div>
  );
}

/** Etapas agrupadas por embudo, para los selectores de «a qué etapa». */
function StageOptions({ stages }: { stages: StageRef[] }) {
  const pipelines = [...new Set(stages.map((s) => s.pipelineName))];
  return (
    <>
      {pipelines.map((p) => (
        <optgroup key={p} label={p}>
          {stages
            .filter((s) => s.pipelineName === p)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

/** Lo que hace la página con sus leads, en palabras: «Nuevo (Ventas)», «sin oportunidad». */
function pageTarget(page: MetaPageDto, stages: StageRef[]): string {
  if (!page.createDeal) return "sin oportunidad";
  const s = stages.find((x) => x.id === page.dealStageId);
  return s ? `${s.name} · ${s.pipelineName}` : "primera etapa";
}

function PageRow({
  page,
  sources,
  tags,
  templates,
  stages,
  onChanged,
  onReauthorize,
}: {
  page: MetaPageDto;
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  templates: TemplateDto[];
  stages: StageRef[];
  onChanged: () => void;
  onReauthorize: () => void;
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
  // Sin fuente elegida, sus leads reciben la automática (la API la crea con el primero).
  const formSource = sources.find((s) => s.name === META_FORM_SOURCE_NAME);
  // «none» = sin oportunidad; «default» = primera etapa del embudo predeterminado.
  const dealValue = !page.createDeal
    ? "none"
    : page.dealStageId && stages.some((s) => s.id === page.dealStageId)
      ? page.dealStageId
      : "default";

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong>{page.name}</strong>
        {page.subscribedAt ? (
          <span style={pill("#0a6b42")}>Recibiendo leads</span>
        ) : (
          <span style={pill("#8a5300")}>Sin suscribir</span>
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
          style={{ ...ghostBtn, color: "var(--danger)", borderColor: "var(--danger-border)" }}
        >
          Desconectar
        </button>
      </div>

      <div style={grid}>
        <label>
          <div style={label}>Fuente que se asigna</div>
          <select
            style={input}
            value={page.sourceId && page.sourceId !== formSource?.id ? page.sourceId : ""}
            onChange={(e) => save.mutate({ sourceId: e.target.value || null })}
          >
            <option value="">{META_FORM_SOURCE_NAME} (automática)</option>
            {sources.filter((s) => s.id !== formSource?.id).map((s) => (
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

      <label>
        <div style={label}>Oportunidad para sus leads</div>
        <select
          style={input}
          value={dealValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none") save.mutate({ createDeal: false });
            else save.mutate({ createDeal: true, dealStageId: v === "default" ? null : v });
          }}
          data-page-stage
        >
          <option value="none">No crear oportunidad</option>
          <option value="default">Primera etapa del embudo predeterminado</option>
          <StageOptions stages={stages} />
        </select>
        <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
          Si el cliente ya tiene una oportunidad en curso, no se crea otra. Cada formulario puede ir a otra etapa (abajo).
        </div>
      </label>

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

      <PageForms
        page={page}
        stages={stages}
        sources={sources}
        tags={tags}
        saving={save.isPending}
        onPatch={(input) => save.mutate(input)}
        onReauthorize={onReauthorize}
      />
    </div>
  );
}

/**
 * Los formularios de la página: si sus leads entran y a qué etapa va cada uno,
 * y «Configurar» abre la ventana con todo lo demás (fuente, etiquetas, campos,
 * vista previa y leads). Sin tocar, siguen a la página. Si Meta no deja
 * listarlos (falta un permiso), salen los que ya mandaron algún lead y se
 * ofrece volver a autorizar.
 */
function PageForms({
  page,
  stages,
  sources,
  tags,
  saving,
  onPatch,
  onReauthorize,
}: {
  page: MetaPageDto;
  stages: StageRef[];
  sources: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  saving: boolean;
  onPatch: (input: UpdateMetaPageInput) => void;
  onReauthorize: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ["meta-forms", page.id],
    queryFn: () => fetchMetaPageForms(page.id),
  });
  const forms = data?.forms ?? [];
  const ruleOf = (f: MetaLeadFormDto): MetaFormRule => ({
    formId: f.formId,
    formName: f.formName,
    enabled: f.enabled,
    stage: f.stage,
    source: f.source,
    tagIds: f.tagIds,
    fieldMap: f.fieldMap,
  });
  const setRule = (f: MetaLeadFormDto, patch: Partial<MetaFormRule>) =>
    onPatch({ formRules: [...page.formRules.filter((r) => r.formId !== f.formId), { ...ruleOf(f), ...patch }] });
  const known = (stage: string) => stage === "page" || stage === "none" || stages.some((s) => s.id === stage);
  // Lo que el formulario cambia respecto a la página, para verlo sin abrirlo.
  const changes = (f: MetaLeadFormDto) =>
    [
      f.source !== "page" ? "fuente propia" : "",
      f.tagIds.length ? `${f.tagIds.length} etiqueta${f.tagIds.length === 1 ? "" : "s"}` : "",
      Object.keys(f.fieldMap).length ? `${Object.keys(f.fieldMap).length} campo${Object.keys(f.fieldMap).length === 1 ? "" : "s"} a mano` : "",
    ].filter(Boolean);
  const current = open ? forms.find((f) => f.formId === open) : null;

  return (
    <section data-meta-forms={page.id}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ ...label, marginBottom: 0 }}>Formularios</div>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }} title="Qué pasa con un formulario que crees después, mientras no lo configures">
          Nuevos:
          <select
            style={{ ...input, width: "auto", padding: "5px 8px", fontSize: 12.5 }}
            value={page.newFormsEnter ? "enter" : "wait"}
            disabled={saving}
            onChange={(e) => onPatch({ newFormsEnter: e.target.value === "enter" })}
            aria-label="Formularios nuevos"
            data-new-forms-policy
          >
            <option value="enter">entran solos</option>
            <option value="wait">esperan a que los actives</option>
          </select>
        </label>
        <button type="button" style={ghostBtn} disabled={isFetching} onClick={() => void refetch()} title="Vuelve a pedir la lista a Meta" data-refresh-forms>
          {isFetching ? "Actualizando…" : "Actualizar lista"}
        </button>
      </div>
      {isPending && <p style={{ ...muted, margin: 0 }}>Cargando formularios…</p>}
      {!isPending && data && !data.fromMeta && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", marginBottom: 6, border: "1px solid var(--border)", background: "var(--warning-soft)" }} data-forms-denied>
          <span style={{ fontSize: 12.5, flex: "1 1 240px", lineHeight: 1.45 }}>
            Meta no deja leer la lista de formularios con los permisos que diste: solo salen los que ya trajeron leads, y uno nuevo entra como indica la página. Vuelve a autorizar la página aceptando todos los permisos para verlos todos.
          </span>
          <button type="button" style={ghostBtn} onClick={onReauthorize} data-reauthorize>
            Volver a autorizar
          </button>
        </div>
      )}
      {!isPending && forms.length === 0 && data?.fromMeta && (
        <p style={{ ...muted, fontSize: 13, margin: 0 }}>Esta página aún no tiene formularios de clientes potenciales.</p>
      )}
      {forms.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {forms.map((f) => (
            <div key={f.formId} style={formRow} data-meta-form={f.formId}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 220px", minWidth: 0, cursor: "pointer" }} title={f.enabled ? "Sus leads entran al CRM" : "Sus leads se ignoran"}>
                <input type="checkbox" checked={f.enabled} disabled={saving} onChange={(e) => setRule(f, { enabled: e.target.checked })} aria-label={`Importar ${f.formName}`} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: f.enabled ? "var(--text)" : "var(--muted)" }}>
                    {f.formName}
                    {f.status === "ARCHIVED" && <span style={{ ...pill("#3f5b6b"), marginLeft: 6 }}>Archivado</span>}
                  </span>
                  <span style={{ ...muted, fontSize: 12 }}>
                    {f.leadCount ? `${f.leadCount} lead${f.leadCount === 1 ? "" : "s"}` : "Sin leads aún"}
                    {f.lastLeadAt ? ` · último ${new Date(f.lastLeadAt).toLocaleDateString("es", { day: "numeric", month: "short" })}` : ""}
                    {changes(f).map((c) => ` · ${c}`).join("")}
                  </span>
                </span>
              </label>
              <select
                style={{ ...input, width: 260, flex: "0 1 260px" }}
                value={known(f.stage) ? f.stage : "page"}
                disabled={!f.enabled || saving}
                onChange={(e) => setRule(f, { stage: e.target.value })}
                aria-label={`Etapa de ${f.formName}`}
              >
                <option value="page">Como la página ({pageTarget(page, stages)})</option>
                <option value="none">No crear oportunidad</option>
                <StageOptions stages={stages} />
              </select>
              <button type="button" style={{ ...ghostBtn, color: "var(--text)" }} onClick={() => setOpen(f.formId)} data-form-settings={f.formId}>
                Configurar
              </button>
            </div>
          ))}
        </div>
      )}
      {current && (
        <MetaFormDialog
          key={current.formId}
          page={page}
          form={current}
          stages={stages}
          sources={sources}
          tags={tags}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
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
        style={{ ...ghostBtn, color: "var(--danger)", borderColor: "var(--danger-border)" }}
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

const formRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 9,
};

const settingsPanel: React.CSSProperties = {
  flexBasis: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  marginTop: 4,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const questionRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
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
    color: readableInk(bg),
  };
}
