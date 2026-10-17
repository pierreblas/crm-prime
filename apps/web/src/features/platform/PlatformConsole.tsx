"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PLANS, PLAN_KEYS, planFor, type PlatformHealth, type PlatformOrg, type UpdatePlatformOrgInput } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { fetchPlatformAudit, fetchPlatformHealth, fetchPlatformOrgs, fetchPlatformOverview, updatePlatformOrg } from "@/lib/bff";
import { OrgDrawer } from "./OrgDrawer";
import { date, dateTime, describeAudit, expiry, money, relative, toCsv } from "./platformFormat";

type SortKey = "created" | "activity" | "messages" | "name" | "expiry";
type Tab = "orgs" | "health" | "audit";
type StateFilter = "all" | "active" | "suspended" | "paying" | "expiring" | "quiet" | "problems" | "limit" | "overuse" | "onboarding";

const STATE_LABEL: Record<StateFilter, string> = {
  all: "Todas",
  active: "Activas",
  suspended: "Suspendidas",
  paying: "De pago",
  expiring: "Vencen en 7 días o vencidas",
  quiet: "Sin actividad en 14 días",
  problems: "Con problemas",
  limit: "Al tope de contactos del plan",
  overuse: "Más activos al mes que su plan",
  onboarding: "Primeros pasos sin terminar",
};

/** ¿Supera los contactos activos al mes para los que está pensado su plan? */
const overActive = (o: PlatformOrg) => {
  const lim = planFor(o.plan).limits.activeContacts;
  return lim !== null && o.activeContactsMonth > lim;
};

/** ¿Está en el tope de contactos de su plan (o por encima, si bajó de plan)? */
const atContactLimit = (o: PlatformOrg) => {
  const lim = planFor(o.plan).limits.contacts;
  return lim !== null && o.contacts >= lim;
};

/**
 * Consola del operador del SaaS: cuántas empresas hay, cuántas se dan de alta,
 * cuáles están vivas y pagan, qué está roto, y qué hizo el operador. Las
 * cifras vienen agregadas de la API; aquí solo se filtran, se ordenan y se
 * pintan. La ficha de cada empresa se abre en un panel lateral.
 */
export function PlatformConsole({ myOrgSlug }: { myOrgSlug?: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("orgs");
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<string>("all");
  const [state, setState] = useState<StateFilter>("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [openOrg, setOpenOrg] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: fetchPlatformOverview,
    refetchOnWindowFocus: true,
  });
  const orgs = useQuery({
    queryKey: ["platform", "orgs", search],
    queryFn: () => fetchPlatformOrgs(search),
    placeholderData: keepPreviousData,
  });
  const health = useQuery({
    queryKey: ["platform", "health"],
    queryFn: fetchPlatformHealth,
    enabled: tab === "health",
    refetchInterval: tab === "health" ? 30_000 : false,
  });
  const audit = useQuery({
    queryKey: ["platform", "audit"],
    queryFn: () => fetchPlatformAudit(200),
    enabled: tab === "audit",
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePlatformOrgInput }) => updatePlatformOrg(id, input),
    onSuccess: () => {
      toast.success("Plan cambiado");
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = useMemo(() => {
    const now = Date.now();
    const list = (orgs.data ?? []).filter((o) => {
      if (plan !== "all" && o.plan !== plan) return false;
      switch (state) {
        case "active":
          return o.isActive;
        case "suspended":
          return !o.isActive;
        case "paying":
          return o.isActive && o.plan !== "free";
        case "expiring":
          return o.isActive && expiry(o).days <= 7;
        case "quiet":
          return !o.lastMessageAt || now - new Date(o.lastMessageAt).getTime() > 14 * 86_400_000;
        case "problems":
          return o.numbersWithError > 0 || o.failedMessages24h > 0;
        case "limit":
          return atContactLimit(o);
        case "overuse":
          return overActive(o);
        case "onboarding":
          return !o.onboardingCompletedAt;
        default:
          return true;
      }
    });
    const by: Record<SortKey, (a: PlatformOrg, b: PlatformOrg) => number> = {
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      activity: (a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
      messages: (a, b) => b.messages30d - a.messages30d,
      name: (a, b) => a.name.localeCompare(b.name, "es"),
      expiry: (a, b) => expiry(a).days - expiry(b).days,
    };
    return list.sort(by[sort]);
  }, [orgs.data, plan, state, sort]);

  const exportCsv = () => {
    const csv = toCsv(
      filtered.map((o) => ({
        empresa: o.name,
        subdominio: o.slug,
        url: o.url,
        plan: planFor(o.plan).name,
        pagado_hasta: o.planExpiresAt ? o.planExpiresAt.slice(0, 10) : "",
        estado: o.isActive ? "activa" : "suspendida",
        administrador: o.adminEmail ?? "",
        usuarios: o.users,
        numeros: o.numbers,
        contactos: o.contacts,
        mensajes_30d: o.messages30d,
        ultima_actividad: o.lastMessageAt ?? "",
        ia_mes_usd: o.aiCostMonthUsd.toFixed(2),
        alta: o.createdAt.slice(0, 10),
        notas: o.platformNotes ?? "",
      })),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    a.download = `driony-empresas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const o = overview.data;

  return (
    <div className="pc">
      <section className="pc-kpis" aria-label="Cifras de la plataforma">
        <Kpi label="Empresas" value={o?.orgs} sub={o ? `${o.activeOrgs} activas` : undefined} />
        <Kpi label="Altas en 7 días" value={o?.new7d} sub={o ? `${o.new30d} en 30 días` : undefined} accent />
        <Kpi label="Con actividad" value={o?.orgsActive7d} sub="mensajes esta semana" />
        <Kpi label="De pago" value={o?.payingOrgs} sub={o ? `${money(o.mrrUsd)} al mes a precio de lista` : undefined} />
        <Kpi label="Vencen en 7 días" value={o?.expiring7d} sub="o ya vencidas" warn={!!o && o.expiring7d > 0} />
        <Kpi label="Números" value={o?.numbers} sub={o ? `${o.coexistenceNumbers} en coexistencia` : undefined} />
        <Kpi label="Números con error" value={o?.numbersWithError} sub="token caducado, etc." warn={!!o && o.numbersWithError > 0} />
        <Kpi label="Mensajes en 7 días" value={o?.messages7d} />
        <Kpi label="Gasto IA del mes" value={o ? money(o.aiCostMonthUsd) : undefined} sub="lo pagan ellas" />
      </section>

      <div className="pc-tabs">
        <div className="seg" role="tablist" aria-label="Secciones de la consola">
          {(
            [
              ["orgs", "Empresas"],
              ["health", "Salud"],
              ["audit", "Diario"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "orgs" && (
        <>
          <div className="pc-grid2">
            <section className="pc-panel">
              <div className="pc-panel__head">
                <h2>Altas por día</h2>
                <span className="pc-plans">
                  {(o?.byPlan ?? []).map((p) => (
                    <span key={p.plan} className="pc-chip">
                      {planFor(p.plan).name} · {p.count}
                    </span>
                  ))}
                </span>
              </div>
              <SignupsChart data={o?.signupsByDay ?? []} loading={overview.isPending} />
            </section>
            <section className="pc-panel">
              <div className="pc-panel__head">
                <h2>Mensajes por día</h2>
              </div>
              <TrafficChart data={o?.messagesByDay ?? []} loading={overview.isPending} />
            </section>
          </div>

          <section className="pc-panel">
            <div className="pc-panel__head">
              <h2>
                Empresas <span className="pc-muted" style={{ fontWeight: 500, fontSize: 13 }}>· {filtered.length}</span>
              </h2>
              <div className="pc-filters">
                <label className="pc-search">
                  <NavIcon name="search" size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nombre, subdominio o correo"
                    aria-label="Buscar empresas"
                  />
                </label>
                <select className="pc-select" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Filtrar por plan">
                  <option value="all">Todos los planes</option>
                  {PLAN_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {PLANS[k].name}
                    </option>
                  ))}
                </select>
                <select className="pc-select" value={state} onChange={(e) => setState(e.target.value as StateFilter)} aria-label="Filtrar por estado">
                  {(Object.keys(STATE_LABEL) as StateFilter[]).map((k) => (
                    <option key={k} value={k}>
                      {STATE_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={filtered.length === 0} title="Descarga las empresas filtradas en CSV">
                  <NavIcon name="arrow-down" size={14} /> CSV
                </button>
              </div>
            </div>

            {orgs.isError && <p style={{ color: "var(--danger)" }}>No se pudieron cargar las empresas.</p>}

            <div className="pc-table-wrap">
              <table className="pc-table" data-orgs-table>
                <thead>
                  <tr>
                    <Th onClick={() => setSort("name")} active={sort === "name"}>Empresa</Th>
                    <th>Plan</th>
                    <Th onClick={() => setSort("expiry")} active={sort === "expiry"}>Pagado hasta</Th>
                    <th className="num">Equipo</th>
                    <th className="num">Números</th>
                    <th className="num">Contactos</th>
                    <Th onClick={() => setSort("messages")} active={sort === "messages"} num>Mensajes 30 d</Th>
                    <Th onClick={() => setSort("activity")} active={sort === "activity"}>Última actividad</Th>
                    <th className="num">IA mes</th>
                    <th>Alertas</th>
                    <Th onClick={() => setSort("created")} active={sort === "created"}>Alta</Th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.isPending &&
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={12}>
                          <div className="skeleton" style={{ height: 22 }} />
                        </td>
                      </tr>
                    ))}
                  {filtered.map((org) => {
                    const mine = !!myOrgSlug && org.slug === myOrgSlug;
                    const busy = update.isPending && update.variables?.id === org.id;
                    const ex = expiry(org);
                    return (
                      <tr key={org.id} className={org.isActive ? "" : "is-suspended"} data-org-row={org.slug}>
                        <td>
                          <div className="pc-org">
                            <button type="button" className="pc-org__name pc-th" onClick={() => setOpenOrg(org.id)} title="Abrir la ficha" style={{ textAlign: "left" }}>
                              {org.name}
                              {mine && <span className="pc-chip pc-chip--mine">tú</span>}
                            </button>
                            <span className="pc-org__meta">
                              {org.slug} · {org.adminEmail ?? "sin administrador"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <select
                            className="pc-select"
                            value={PLAN_KEYS.includes(org.plan as (typeof PLAN_KEYS)[number]) ? org.plan : "free"}
                            disabled={busy}
                            aria-label={`Plan de ${org.name}`}
                            onChange={(e) => update.mutate({ id: org.id, input: { plan: e.target.value as (typeof PLAN_KEYS)[number] } })}
                          >
                            {PLAN_KEYS.map((k) => (
                              <option key={k} value={k}>
                                {PLANS[k].name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {ex.kind === "expired" ? (
                            <span className="pc-danger">{ex.label}</span>
                          ) : ex.kind === "soon" ? (
                            <span className="pc-warn">{ex.label}</span>
                          ) : (
                            <span className={ex.kind === "none" ? "pc-muted" : undefined}>{ex.label}</span>
                          )}
                        </td>
                        <td className="num">{org.users}</td>
                        <td className="num" title={`${org.coexistenceNumbers} en coexistencia`}>
                          {org.numbers}
                          {org.coexistenceNumbers > 0 && <small> · {org.coexistenceNumbers} coex.</small>}
                        </td>
                        <td className="num">{org.contacts.toLocaleString("es")}</td>
                        <td className="num">{org.messages30d.toLocaleString("es")}</td>
                        <td title={org.lastMessageAt ?? undefined}>{relative(org.lastMessageAt)}</td>
                        <td className="num">{org.aiCostMonthUsd > 0 ? money(org.aiCostMonthUsd) : "—"}</td>
                        <td>
                          <span className="pc-alerts">
                            {org.numbersWithError > 0 && (
                              <span className="pc-danger" title="Números con error (token caducado, etc.)">
                                {org.numbersWithError} núm.
                              </span>
                            )}
                            {org.failedMessages24h > 0 && (
                              <span className="pc-warn" title="Envíos fallidos en 24 horas">
                                {org.failedMessages24h} fallidos
                              </span>
                            )}
                            {overActive(org) && (
                              <span className="pc-warn" title={`${org.activeContactsMonth.toLocaleString("es")} contactos activos este mes, por encima de su plan: candidata a subir`}>
                                {org.activeContactsMonth.toLocaleString("es")} activos
                              </span>
                            )}
                            {atContactLimit(org) && (
                              <span className="pc-warn" title="Al tope de contactos de su plan: candidata a subir de plan">
                                contactos al tope
                              </span>
                            )}
                            {!org.onboardingCompletedAt && <span className="pc-muted" title="Primeros pasos sin terminar">en curso</span>}
                            {org.numbersWithError === 0 && org.failedMessages24h === 0 && org.onboardingCompletedAt && <span className="pc-ok"><NavIcon name="check" size={13} /></span>}
                          </span>
                        </td>
                        <td title={org.createdAt}>{date(org.createdAt)}</td>
                        <td>
                          <div className="pc-state">
                            <span className={`pc-badge ${org.isActive ? "is-on" : "is-off"}`}>{org.isActive ? "Activa" : "Suspendida"}</span>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenOrg(org.id)} aria-label={`Ficha de ${org.name}`}>
                              Ficha
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {orgs.data && filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} className="pc-muted" style={{ textAlign: "center", padding: 24 }}>
                        Ninguna empresa coincide.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === "health" && <HealthPanel health={health.data} loading={health.isPending} error={health.isError} onOpen={setOpenOrg} />}

      {tab === "audit" && (
        <section className="pc-panel">
          <div className="pc-panel__head">
            <h2>Diario del operador</h2>
            <span className="pc-muted" style={{ fontSize: 12.5 }}>Cambios de plan, suspensiones, vencimientos, notas y accesos «Entrar como».</span>
          </div>
          {audit.isPending && <div className="skeleton" style={{ height: 80 }} />}
          {audit.data && audit.data.length === 0 && <p className="pc-empty">Nada todavía.</p>}
          {audit.data && audit.data.length > 0 && (
            <table className="pc-table is-compact" data-audit-table>
              <thead>
                <tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Empresa</th></tr>
              </thead>
              <tbody>
                {audit.data.map((e) => (
                  <tr key={e.id}>
                    <td title={e.createdAt}>{dateTime(e.createdAt)}</td>
                    <td>{e.actorEmail}</td>
                    <td className="wrap">{describeAudit(e)}</td>
                    <td>
                      {e.orgId ? (
                        <button type="button" className="pc-th" onClick={() => setOpenOrg(e.orgId!)} style={{ color: "var(--accent-text)" }}>
                          {e.orgName ?? e.orgSlug ?? e.orgId}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {openOrg && <OrgDrawer id={openOrg} myOrgSlug={myOrgSlug} onClose={() => setOpenOrg(null)} />}
    </div>
  );
}

function HealthPanel({ health, loading, error, onOpen }: { health?: PlatformHealth; loading: boolean; error: boolean; onOpen: (id: string) => void }) {
  if (error) return <p style={{ color: "var(--danger)" }}>No se pudo cargar la salud de la plataforma.</p>;
  if (loading || !health) return <div className="skeleton" style={{ height: 160 }} />;
  const failedRatio = health.outbound24h.sent + health.outbound24h.failed > 0 ? (health.outbound24h.failed / (health.outbound24h.sent + health.outbound24h.failed)) * 100 : 0;
  return (
    <>
      <section className="pc-panel" data-health>
        <div className="pc-panel__head">
          <h2>Colas</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>
            Envíos en 24 h: <b style={{ color: "var(--text)" }}>{health.outbound24h.sent.toLocaleString("es")}</b> ok ·{" "}
            <b style={{ color: health.outbound24h.failed > 0 ? "var(--danger)" : "var(--text)" }}>{health.outbound24h.failed.toLocaleString("es")}</b> fallidos
            {failedRatio > 0 && ` (${failedRatio.toFixed(1)} %)`}
          </span>
        </div>
        <div className="pc-queues">
          {health.queues.map((q) => (
            <div key={q.name} className={`pc-queue${!q.ok || q.failed > 0 ? " is-bad" : ""}`}>
              <span className="pc-queue__name">{q.name}{!q.ok && <span className="pc-danger" style={{ marginLeft: 6 }}>sin Redis</span>}</span>
              <span className="pc-queue__nums">
                <span title="Esperando"><b>{q.waiting}</b> en cola</span>
                <span title="En proceso"><b>{q.active}</b> activos</span>
                <span title="Programados"><b>{q.delayed}</b> prog.</span>
                <span className={q.failed > 0 ? "is-failed" : undefined} title="Fallidos (se conservan los últimos)"><b>{q.failed}</b> fallidos</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="pc-panel">
        <div className="pc-panel__head">
          <h2>Números con error · {health.numbersWithError.length}</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>Token caducado, número desconectado en Meta… La empresa tiene que volver a conectarlo.</span>
        </div>
        {health.numbersWithError.length === 0 ? (
          <p className="pc-empty">Ninguno. Todos los números conectados responden.</p>
        ) : (
          <table className="pc-table is-compact">
            <thead>
              <tr><th>Empresa</th><th>Número</th><th>Motivo</th><th>Desde</th></tr>
            </thead>
            <tbody>
              {health.numbersWithError.map((n) => (
                <tr key={n.id}>
                  <td><button type="button" className="pc-th" onClick={() => onOpen(n.orgId)} style={{ color: "var(--accent-text)" }}>{n.orgName}</button></td>
                  <td>{n.number ?? "—"}{n.label && <span className="pc-muted"> · {n.label}</span>}</td>
                  <td className="wrap">{n.reason ?? "—"}</td>
                  <td>{relative(n.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="pc-panel">
        <div className="pc-panel__head">
          <h2>Envíos fallidos en 24 h · por empresa</h2>
        </div>
        {health.failedByOrg.length === 0 ? (
          <p className="pc-empty">Ningún envío fallido en las últimas 24 horas.</p>
        ) : (
          <table className="pc-table is-compact">
            <thead>
              <tr><th>Empresa</th><th className="num">Fallidos</th><th>Último error</th></tr>
            </thead>
            <tbody>
              {health.failedByOrg.map((f) => (
                <tr key={f.orgId}>
                  <td><button type="button" className="pc-th" onClick={() => onOpen(f.orgId)} style={{ color: "var(--accent-text)" }}>{f.orgName}</button></td>
                  <td className="num">{f.count}</td>
                  <td className="wrap">{f.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="pc-panel">
        <div className="pc-panel__head">
          <h2>Webhooks salientes que fallan · {health.webhooksFailing.length}</h2>
        </div>
        {health.webhooksFailing.length === 0 ? (
          <p className="pc-empty">Ninguno.</p>
        ) : (
          <table className="pc-table is-compact">
            <thead>
              <tr><th>Empresa</th><th>URL</th><th className="num">Fallos</th><th>Último</th></tr>
            </thead>
            <tbody>
              {health.webhooksFailing.map((w) => (
                <tr key={`${w.orgId}-${w.url}`}>
                  <td><button type="button" className="pc-th" onClick={() => onOpen(w.orgId)} style={{ color: "var(--accent-text)" }}>{w.orgName}</button></td>
                  <td className="wrap">{w.url}</td>
                  <td className="num">{w.failedCount}</td>
                  <td className="wrap">{w.lastStatus ? `HTTP ${w.lastStatus} · ` : ""}{w.lastError ?? ""}{w.lastDeliveryAt ? ` · ${relative(w.lastDeliveryAt)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Kpi({ label, value, sub, accent, warn }: { label: string; value?: number | string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`pc-kpi${accent ? " is-accent" : ""}`} style={warn ? { borderColor: "rgba(224, 164, 88, 0.55)" } : undefined}>
      <span className="pc-kpi__label">{label}</span>
      {value === undefined ? (
        <span className="skeleton" style={{ height: 28, width: 60, display: "block" }} />
      ) : (
        <span className="pc-kpi__value" style={warn && value !== 0 ? { color: "var(--warning)" } : undefined}>
          {typeof value === "number" ? value.toLocaleString("es") : value}
        </span>
      )}
      {sub && <span className="pc-kpi__sub">{sub}</span>}
    </div>
  );
}

function Th({ children, onClick, active, num }: { children: React.ReactNode; onClick: () => void; active: boolean; num?: boolean }) {
  return (
    <th className={num ? "num" : undefined} aria-sort={active ? "descending" : "none"}>
      <button type="button" className={`pc-th${active ? " is-active" : ""}`} onClick={onClick}>
        {children}
        {active && <NavIcon name="arrow-down" size={12} />}
      </button>
    </th>
  );
}

/** Últimos 30 días, con los días vacíos a cero. */
function lastDays<T extends { day: string }>(data: T[], n: number, empty: (day: string) => T): T[] {
  const byDay = new Map(data.map((d) => [d.day, d]));
  const out: T[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? empty(key));
  }
  return out;
}

/** Treinta días de barras. Los días sin altas también se pintan (a cero). */
function SignupsChart({ data, loading }: { data: { day: string; count: number }[]; loading: boolean }) {
  const days = useMemo(() => lastDays(data, 30, (day) => ({ day, count: 0 })), [data]);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, d) => a + d.count, 0);

  if (loading) return <div className="skeleton" style={{ height: 120 }} />;
  return (
    <div>
      <div className="pc-chart" role="img" aria-label={`${total} altas en los últimos 30 días`}>
        {days.map((d) => (
          <span
            key={d.day}
            className={`pc-bar${d.count ? " has-value" : ""}`}
            style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
            title={`${date(d.day)}: ${d.count} ${d.count === 1 ? "alta" : "altas"}`}
          />
        ))}
      </div>
      <div className="pc-chart__axis">
        <span>{date(days[0]!.day)}</span>
        <span>{total} altas en 30 días</span>
        <span>hoy</span>
      </div>
    </div>
  );
}

/** Treinta días de mensajes: recibidos (violeta) sobre enviados (verde). */
function TrafficChart({ data, loading }: { data: { day: string; inbound: number; outbound: number }[]; loading: boolean }) {
  const days = useMemo(() => lastDays(data, 30, (day) => ({ day, inbound: 0, outbound: 0 })), [data]);
  const max = Math.max(1, ...days.map((d) => d.inbound + d.outbound));
  const totalIn = days.reduce((a, d) => a + d.inbound, 0);
  const totalOut = days.reduce((a, d) => a + d.outbound, 0);

  if (loading) return <div className="skeleton" style={{ height: 120 }} />;
  return (
    <div>
      <div className="pc-bars" style={{ height: 120 }} role="img" aria-label={`${totalIn + totalOut} mensajes en 30 días`}>
        {days.map((d) => (
          <div key={d.day} className="pc-bars__day" title={`${date(d.day)}: ${d.inbound} recibidos · ${d.outbound} enviados`}>
            <span className="pc-bars__out" style={{ height: `${(d.outbound / max) * 100}%` }} />
            <span className="pc-bars__in" style={{ height: `${(d.inbound / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="pc-legend">
        <span><i style={{ background: "var(--accent)" }} />Recibidos · {totalIn.toLocaleString("es")}</span>
        <span><i style={{ background: "var(--positive)" }} />Enviados · {totalOut.toLocaleString("es")}</span>
        <span style={{ marginLeft: "auto" }}>{date(days[0]!.day)} → hoy</span>
      </div>
    </div>
  );
}
