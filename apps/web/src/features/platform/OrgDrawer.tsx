"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PLANS, PLAN_KEYS, includedAiCapUsd, planFor, type PlatformOrgDetail, type UpdatePlatformOrgInput } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { fetchPlatformOrgDetail, platformLoginAs, updatePlatformOrg } from "@/lib/bff";
import { date, dateTime, describeAudit, expiry, fromDateInput, money, relative, toDateInput } from "./platformFormat";

const FEATURE_LABEL: Record<string, string> = {
  agent: "Agente",
  classify: "Clasificación",
  copilot: "Copiloto",
  playground: "Playground",
  prompt_assistant: "Asistente de prompts",
  flow_assistant: "Asistente de flujos",
  knowledge_gaps: "Huecos de conocimiento",
  knowledge_index: "Índice de conocimiento",
  media: "Audios e imágenes",
  follow_up: "Seguimientos",
};

/**
 * La ficha de una empresa, en un panel lateral: lo que el operador necesita
 * para atender un correo de soporte o decidir sobre su plan sin entrar en su
 * panel. Y si hace falta entrar, el botón «Entrar como» lo hace con un pase
 * de un solo uso que queda en el diario.
 */
export function OrgDrawer({ id, myOrgSlug, onClose }: { id: string; myOrgSlug?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "org", id], queryFn: () => fetchPlatformOrgDetail(id) });
  const update = useMutation({
    mutationFn: (input: UpdatePlatformOrgInput) => updatePlatformOrg(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["platform"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const loginAs = useMutation({
    mutationFn: async () => {
      // La ventana se abre en el clic (bloqueador de emergentes) y recibe la URL al llegar el pase.
      const w = window.open("about:blank", "_blank");
      try {
        const r = await platformLoginAs(id);
        if (w && !w.closed) w.location.href = r.url;
        else window.location.assign(r.url);
        return r;
      } catch (e) {
        w?.close();
        throw e;
      }
    },
    onSuccess: (r) => {
      toast.success(`Pase emitido: entras como ${r.email}`);
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = q.data;
  const org = d?.org;
  const mine = !!myOrgSlug && org?.slug === myOrgSlug;

  return (
    <>
      <div className="pc-drawer__backdrop" onClick={onClose} />
      <aside className="pc-drawer" role="dialog" aria-modal="true" aria-label={org ? `Ficha de ${org.name}` : "Ficha de empresa"} data-org-drawer={id}>
        <header className="pc-drawer__head">
          <div className="pc-drawer__title">
            <h2>{org?.name ?? "Cargando…"}</h2>
            {org && (
              <span className="pc-org__meta">
                <a href={org.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-text)" }}>
                  {org.slug}
                </a>{" "}
                · alta el {date(org.createdAt)} · {org.adminEmail ?? "sin administrador"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {org && <span className={`pc-badge ${org.isActive ? "is-on" : "is-off"}`}>{org.isActive ? "Activa" : "Suspendida"}</span>}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
              <NavIcon name="x" size={16} />
            </button>
          </div>
        </header>

        <div className="pc-drawer__body">
          {q.isError && <p style={{ color: "var(--danger)" }}>{(q.error as Error).message}</p>}
          {!d && !q.isError && <div className="skeleton" style={{ height: 120 }} />}
          {d && org && (
            <>
              {/* Plan, vencimiento, acceso */}
              <section className="pc-section">
                <h3>Plan y acceso</h3>
                <div className="pc-actions">
                  <label>
                    Plan
                    <select
                      className="pc-select"
                      value={PLAN_KEYS.includes(org.plan as (typeof PLAN_KEYS)[number]) ? org.plan : "free"}
                      disabled={update.isPending}
                      aria-label="Plan"
                      onChange={(e) => update.mutate({ plan: e.target.value as (typeof PLAN_KEYS)[number] })}
                    >
                      {PLAN_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {PLANS[k].name}
                          {PLANS[k].priceUsd ? ` · USD ${PLANS[k].priceUsd}/mes` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label title="Hasta cuándo está pagado. Es informativo: no corta nada solo.">
                    Pagado hasta
                    <input
                      type="date"
                      className="pc-select"
                      defaultValue={toDateInput(org.planExpiresAt)}
                      key={org.planExpiresAt ?? "none"}
                      aria-label="Pagado hasta"
                      onBlur={(e) => {
                        const next = fromDateInput(e.target.value);
                        if (next !== org.planExpiresAt) update.mutate({ planExpiresAt: next });
                      }}
                    />
                    <ExpiryTag org={org} />
                  </label>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={loginAs.isPending || !org.isActive || mine}
                    title={mine ? "Es tu propia empresa" : "Abre su panel en otra pestaña como su administrador. Queda en el diario."}
                    onClick={() => loginAs.mutate()}
                    data-login-as
                  >
                    <NavIcon name="logout" size={14} /> Entrar como admin
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${org.isActive ? "btn-ghost" : "btn-primary"}`}
                    disabled={update.isPending || mine}
                    title={mine ? "Es tu propia empresa" : org.isActive ? "Nadie de la empresa podrá entrar" : "Volver a dar acceso"}
                    onClick={() => {
                      if (org.isActive) {
                        void confirmDialog({
                          message: `¿Suspender "${org.name}"? Nadie de la empresa podrá entrar hasta que la reactives. Sus datos no se tocan.`,
                          danger: true,
                        }).then((ok) => ok && update.mutate({ isActive: false }));
                      } else update.mutate({ isActive: true });
                    }}
                  >
                    {org.isActive ? "Suspender" : "Reactivar"}
                  </button>
                </div>
              </section>

              {/* Notas */}
              <section className="pc-section">
                <h3>Notas internas</h3>
                <NotesEditor key={org.id} value={org.platformNotes} onSave={(v) => update.mutate({ platformNotes: v })} />
              </section>

              {/* Cifras */}
              <section className="pc-section">
                <h3>Este mes</h3>
                <div className="pc-mini">
                  <div><span>Equipo</span><b>{org.users}</b></div>
                  <div><span>Números</span><b>{org.numbers}{org.numbersWithError > 0 && <small className="pc-danger" style={{ marginLeft: 6 }}>{org.numbersWithError} con error</small>}</b></div>
                  <div><span>Contactos</span><b>{org.contacts.toLocaleString("es")}</b></div>
                  <div><span>Mensajes 30 d</span><b>{org.messages30d.toLocaleString("es")}</b></div>
                  <div><span>Activos este mes</span><b>{org.activeContactsMonth.toLocaleString("es")}</b><span>{planFor(org.plan).limits.activeContacts !== null ? `plan: ${planFor(org.plan).limits.activeContacts!.toLocaleString("es")}` : "sin referencia"}</span></div>
                  <div><span>Chats abiertos</span><b>{d.counts.openConversations}</b></div>
                  <div><span>Ganadas 30 d</span><b>{org.wonDeals30d}</b>{d.won30d.length > 0 && <span>{d.won30d.map((w) => `${w.total.toLocaleString("es", { maximumFractionDigits: 0 })} ${w.currency}`).join(" · ")}</span>}</div>
                  <div><span>IA del mes</span><b>{org.aiCostMonthUsd > 0 ? money(org.aiCostMonthUsd) : "—"}</b></div>
                  <div><span>Fallidos 24 h</span><b style={org.failedMessages24h > 0 ? { color: "var(--danger)" } : undefined}>{org.failedMessages24h}</b></div>
                </div>
              </section>

              {/* Actividad */}
              <section className="pc-section">
                <h3>Mensajes · 14 días</h3>
                <ActivityBars data={d.activity} />
              </section>

              {/* Equipo */}
              <section className="pc-section">
                <h3>Equipo · {d.users.length}</h3>
                {d.users.length === 0 ? (
                  <p className="pc-empty">Sin usuarios.</p>
                ) : (
                  <table className="pc-table is-compact">
                    <thead>
                      <tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Último acceso</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                      {d.users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.email}</td>
                          <td>{u.name ?? "—"}</td>
                          <td>{u.role === "ADMIN" ? "Admin" : "Vendedor"}</td>
                          <td title={u.lastSeenAt ?? undefined}>{relative(u.lastSeenAt)}</td>
                          <td>{u.isActive ? <span className="pc-ok">activo</span> : <span className="pc-muted">inactivo</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Números */}
              <section className="pc-section">
                <h3>Números de WhatsApp · {d.numbers.length}</h3>
                {d.numbers.length === 0 ? (
                  <p className="pc-empty">Ningún número conectado todavía.</p>
                ) : (
                  <table className="pc-table is-compact">
                    <thead>
                      <tr><th>Número</th><th>Modo</th><th>Estado</th><th>Conversiones</th><th>Desde</th></tr>
                    </thead>
                    <tbody>
                      {d.numbers.map((w) => (
                        <tr key={w.id}>
                          <td>{w.displayPhoneNumber ?? "—"}{w.label && <span className="pc-muted"> · {w.label}</span>}</td>
                          <td>{w.mode === "coexistence" ? "Coexistencia" : "API"}</td>
                          <td className="wrap">
                            {!w.isActive ? (
                              <span className="pc-muted">desconectado</span>
                            ) : w.status === "error" ? (
                              <span className="pc-danger" title={w.statusReason ?? undefined}>error{w.statusReason ? ` · ${w.statusReason}` : ""}</span>
                            ) : (
                              <span className="pc-ok">conectado</span>
                            )}
                          </td>
                          <td>{w.capiEnabled ? <span className="pc-ok">activas</span> : <span className="pc-muted">no</span>}</td>
                          <td>{date(w.connectedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* IA */}
              <section className="pc-section">
                <h3>Inteligencia artificial · este mes</h3>
                <p className="pc-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
                  {org.aiOwnKey
                    ? "Usa su propia clave de IA: no gasta la IA de Driony y el consumo lo paga ella."
                    : org.aiIncludedLimit !== null
                      ? `IA de Driony: ${org.aiIncludedConversations.toLocaleString("es")} de ${org.aiIncludedLimit.toLocaleString("es")} conversaciones · ${money(org.aiPlatformCostMonthUsd)} de ${money(includedAiCapUsd(org.aiIncludedLimit))} de tope (a precio de lista).`
                      : "Sin clave propia y sin IA incluida: su agente no responde."}
                </p>
                {d.ai.length === 0 ? (
                  <p className="pc-empty">Sin uso de IA este mes.</p>
                ) : (
                  <table className="pc-table is-compact">
                    <thead>
                      <tr><th>Función</th><th>Clave</th><th>Modelo</th><th className="num">Llamadas</th><th className="num">Tokens</th><th className="num">USD lista</th></tr>
                    </thead>
                    <tbody>
                      {d.ai.map((r) => (
                        <tr key={`${r.source}-${r.feature}-${r.model}`}>
                          <td>{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                          <td>{r.source === "platform" ? <span className="pc-chip">Driony</span> : <span className="pc-muted">propia</span>}</td>
                          <td>{r.model}</td>
                          <td className="num">{r.calls.toLocaleString("es")}</td>
                          <td className="num">{(r.inputTokens + r.outputTokens).toLocaleString("es")}</td>
                          <td className="num">{r.usd.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Configuración */}
              <section className="pc-section">
                <h3>Qué tiene configurado</h3>
                <div className="pc-mini">
                  <div><span>Agentes de IA</span><b>{d.counts.agents}</b></div>
                  <div><span>Flujos</span><b>{d.counts.flows}</b></div>
                  <div><span>Difusiones</span><b>{d.counts.campaigns}</b></div>
                  <div><span>Oportunidades</span><b>{d.counts.deals.toLocaleString("es")}</b></div>
                  <div><span>Claves de API</span><b>{d.counts.apiKeys}</b></div>
                  <div><span>Webhooks</span><b>{d.counts.webhooks}</b></div>
                  <div><span>Primeros pasos</span><b style={{ fontSize: 13 }}>{org.onboardingCompletedAt ? "completados" : "en curso"}</b></div>
                  <div><span>Plan</span><b style={{ fontSize: 13 }}>{planFor(org.plan).name}</b></div>
                </div>
              </section>

              {/* Historial */}
              <section className="pc-section">
                <h3>Historial del operador</h3>
                {d.audit.length === 0 ? (
                  <p className="pc-empty">Nada todavía.</p>
                ) : (
                  <table className="pc-table is-compact" data-org-audit>
                    <tbody>
                      {d.audit.map((e) => (
                        <tr key={e.id}>
                          <td style={{ width: 130 }} title={e.createdAt}>{dateTime(e.createdAt)}</td>
                          <td className="wrap">{describeAudit(e)}</td>
                          <td className="pc-muted">{e.actorEmail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function ExpiryTag({ org }: { org: PlatformOrgDetail["org"] }) {
  const e = expiry(org);
  if (e.kind === "none") return null;
  if (e.kind === "expired") return <span className="pc-danger">{e.label}</span>;
  if (e.kind === "soon") return <span className="pc-warn">{e.label}</span>;
  return null;
}

function NotesEditor({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  return (
    <textarea
      className="pc-notes"
      value={text}
      placeholder="Quién es, qué pagó y cuándo, qué pidió por correo… Solo lo ve el operador."
      aria-label="Notas internas"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = text.trim() || null;
        if (v !== (value ?? null)) onSave(v);
      }}
    />
  );
}

/** Catorce días de barras apiladas: recibidos (violeta) y enviados (verde). */
function ActivityBars({ data }: { data: { day: string; inbound: number; outbound: number }[] }) {
  const byDay = new Map(data.map((d) => [d.day, d]));
  const days: { day: string; inbound: number; outbound: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const v = byDay.get(key);
    days.push({ day: key, inbound: v?.inbound ?? 0, outbound: v?.outbound ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.inbound + d.outbound));
  const total = days.reduce((a, d) => a + d.inbound + d.outbound, 0);
  return (
    <div>
      <div className="pc-bars" role="img" aria-label={`${total} mensajes en 14 días`}>
        {days.map((d) => (
          <div key={d.day} className="pc-bars__day" title={`${date(d.day)}: ${d.inbound} recibidos · ${d.outbound} enviados`}>
            <span className="pc-bars__out" style={{ height: `${(d.outbound / max) * 100}%` }} />
            <span className="pc-bars__in" style={{ height: `${(d.inbound / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="pc-legend">
        <span><i style={{ background: "var(--accent)" }} />Recibidos</span>
        <span><i style={{ background: "var(--positive)" }} />Enviados</span>
        <span style={{ marginLeft: "auto" }}>{total.toLocaleString("es")} en 14 días</span>
      </div>
    </div>
  );
}
