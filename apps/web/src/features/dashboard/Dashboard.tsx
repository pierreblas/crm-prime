"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatMoney, type DashboardDto, type DashboardKpi, type DashboardPeriod } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { fetchDashboard } from "@/lib/bff";
import { Funnel, Heatmap, HBars, StackedBars, TimeChart } from "./charts";

const PERIODS: { key: DashboardPeriod; label: string }[] = [
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "90d", label: "90 días" },
];

const C = {
  violet: "#b26bff",
  deep: "#8a2be2",
  green: "#7ee2a8",
  amber: "#e0a458",
  muted: "rgba(178,160,220,.55)",
};

/** "45 s", "4 min", "1,5 h", "2 d". */
export function duration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toLocaleString("es", { maximumFractionDigits: 1 })} h`;
  return `${(sec / 86400).toLocaleString("es", { maximumFractionDigits: 1 })} d`;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);

/** Importe corto para tarjetas y ejes: sin decimales y en miles si hace falta. */
function moneyShort(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      notation: n >= 100_000 ? "compact" : "standard",
    }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

const compactNum = (n: number) =>
  new Intl.NumberFormat("es", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);

/**
 * Panel: cómo va el negocio. Conversaciones, velocidad de respuesta, lo que
 * resuelve la IA, de dónde vienen los leads, el embudo, las ventas y el
 * equipo. Todo en la zona horaria de quien mira.
 */
export function Dashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  const [pipelineId, setPipelineId] = useState<string | undefined>(undefined);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", period, tz, pipelineId],
    queryFn: () => fetchDashboard(period, tz, pipelineId),
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  });

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>Panel</h1>
          <p>
            {data
              ? `Últimos ${period.replace("d", "")} días, comparado con los ${period.replace("d", "")} anteriores.`
              : "Cómo va tu negocio."}
          </p>
        </div>
        <div className="dash__controls">
          {data && data.kpis.awaitingNow > 0 && (
            <Link href="/" className="dash__alert">
              <span className="dash__pulse" />
              {data.kpis.awaitingNow === 1 ? "1 cliente esperando respuesta" : `${data.kpis.awaitingNow} clientes esperando respuesta`}
            </Link>
          )}
          <div className="seg" role="tablist" aria-label="Periodo">
            {PERIODS.map((p) => (
              <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isError && (
        <p style={{ color: "var(--danger)" }}>
          No se pudo cargar el panel.{" "}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {isPending && <Skeleton />}
      {data && (
        <div className={`dash__body${isFetching ? " is-loading" : ""}`}>
          <Kpis data={data} />

          <section className="dash__card dash__wide">
            <CardHead icon="inbox" title="Actividad" hint="Conversaciones nuevas y mensajes de clientes por día" />
            <TimeChart
              days={data.daily.map((d) => d.day)}
              series={[
                { key: "inbound", label: "Mensajes de clientes", color: C.violet, values: data.daily.map((d) => d.inbound) },
                { key: "conv", label: "Conversaciones nuevas", color: C.green, values: data.daily.map((d) => d.conversations), kind: "line" },
              ]}
            />
          </section>

          <div className="dash__grid">
            <section className="dash__card">
              <CardHead
                icon="bot"
                title="Quién responde"
                hint={`La IA dio el ${pct(data.kpis.aiShare.value)} de las respuestas`}
              />
              <StackedBars
                days={data.daily.map((d) => d.day)}
                series={[
                  { key: "ai", label: "IA", color: C.violet, values: data.daily.map((d) => d.outboundAi) },
                  { key: "human", label: "Equipo", color: C.green, values: data.daily.map((d) => d.outboundHuman) },
                ]}
              />
            </section>

            <section className="dash__card">
              <CardHead icon="target" title="De dónde vienen los leads" hint={`${data.kpis.leads.value ?? 0} contactos nuevos`} />
              {data.sources.length ? (
                <HBars items={data.sources.map((s) => ({ label: s.name, value: s.count }))} />
              ) : (
                <Empty text="Sin contactos nuevos en este periodo." />
              )}
            </section>

            <section className="dash__card" data-dash-loss>
              <CardHead icon="x" title="Por qué se pierden" hint={`${data.lossReasons.reduce((a, r) => a + r.count, 0)} perdidas en el periodo`} />
              {data.lossReasons.length ? (
                <HBars items={data.lossReasons.map((r) => ({ label: r.reason, value: r.count }))} />
              ) : (
                <Empty text="Sin oportunidades perdidas en este periodo." />
              )}
            </section>

            <section className="dash__card">
              <div className="dash__cardhead">
                <CardHead icon="pipeline" title="Embudo" hint="Oportunidades abiertas por etapa" />
                {data.funnel.pipelines.length > 1 && (
                  <select
                    className="field field-sm"
                    style={{ width: "auto" }}
                    value={data.funnel.pipelineId ?? ""}
                    onChange={(e) => setPipelineId(e.target.value)}
                    aria-label="Embudo"
                  >
                    {data.funnel.pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {data.funnel.stages.some((s) => s.count > 0) ? (
                <Funnel stages={data.funnel.stages} money={(n) => moneyShort(n, data.currency)} />
              ) : (
                <Empty text="No hay oportunidades en este embudo." />
              )}
            </section>

            <section className="dash__card">
              <CardHead
                icon="trophy"
                title="Ventas ganadas"
                hint={`${data.kpis.wonCount.value ?? 0} ${data.kpis.wonCount.value === 1 ? "cerrada" : "cerradas"} · ${moneyShort(data.kpis.wonValue.value ?? 0, data.currency)}`}
              />
              {data.daily.some((d) => d.wonValue > 0) ? (
                <StackedBars
                  days={data.daily.map((d) => d.day)}
                  series={[{ key: "won", label: "Ganado", color: C.green, values: data.daily.map((d) => d.wonValue) }]}
                  format={(n) => formatMoney(n, data.currency)}
                  axisFormat={compactNum}
                />
              ) : (
                <Empty
                  text={
                    (data.kpis.wonCount.value ?? 0) > 0
                      ? "Hay ventas cerradas, pero sin valor. Pon el valor en cada oportunidad para verlo aquí."
                      : "Sin ventas cerradas en este periodo."
                  }
                />
              )}
            </section>

            <section className="dash__card">
              <CardHead icon="clock" title="Cuándo escriben tus clientes" hint="Mensajes por día y hora" />
              {data.heatmap.flat().some((v) => v > 0) ? <Heatmap data={data.heatmap} /> : <Empty text="Sin mensajes en este periodo." />}
            </section>

            <section className="dash__card">
              <CardHead icon="user" title="Equipo" hint="Conversaciones con actividad en el periodo" />
              {data.team.length ? <Team rows={data.team} /> : <Empty text="Sin conversaciones en este periodo." />}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpis({ data }: { data: DashboardDto }) {
  const k = data.kpis;
  const money = (n: number) => moneyShort(n, data.currency);
  const won = k.wonCount.value ?? 0;
  return (
    <section className="dash__kpis">
      <Kpi icon="inbox" label="Conversaciones" kpi={k.conversations} format={(n) => n.toLocaleString("es")} hint="nuevas" />
      <Kpi icon="user" label="Leads nuevos" kpi={k.leads} format={(n) => n.toLocaleString("es")} />
      <Kpi icon="clock" label="Primera respuesta" kpi={k.firstResponseSec} format={duration} lowerIsBetter hint="mediana" />
      <Kpi icon="bot" label="Respondido por IA" kpi={k.aiShare} format={(n) => pct(n)} ratio />
      <Kpi icon="trophy" label="Ventas ganadas" kpi={k.wonValue} format={money} hint={won === 1 ? "1 oportunidad" : `${won} oportunidades`} />
      <Kpi icon="target" label="Tasa de cierre" kpi={k.winRate} format={(n) => pct(n)} ratio hint="ganadas / cerradas" />
    </section>
  );
}

function Kpi({
  icon,
  label,
  kpi,
  format,
  hint,
  lowerIsBetter,
  ratio,
}: {
  icon: IconName;
  label: string;
  kpi: DashboardKpi;
  format: (n: number) => string;
  hint?: string;
  lowerIsBetter?: boolean;
  ratio?: boolean;
}) {
  const { value, prev } = kpi;
  let delta: { text: string; good: boolean } | null = null;
  if (value !== null && prev !== null) {
    if (ratio) {
      const pp = Math.round((value - prev) * 100);
      if (pp !== 0) delta = { text: `${pp > 0 ? "+" : ""}${pp} pts`, good: pp > 0 };
    } else if (prev > 0) {
      const ch = Math.round(((value - prev) / prev) * 100);
      if (ch !== 0) delta = { text: `${ch > 0 ? "+" : ""}${ch} %`, good: lowerIsBetter ? ch < 0 : ch > 0 };
    } else if (value > 0 && !lowerIsBetter) {
      delta = { text: "antes 0", good: true };
    }
  }
  return (
    <div className="dash__kpi">
      <span className="dash__kpilabel">
        <NavIcon name={icon} size={14} />
        {label}
      </span>
      <strong>{value === null ? "—" : format(value)}</strong>
      <span className="dash__kpifoot">
        {delta && <span className={`dash__delta ${delta.good ? "is-good" : "is-bad"}`}>{delta.text}</span>}
        {hint && <small>{hint}</small>}
      </span>
    </div>
  );
}

function Team({ rows }: { rows: DashboardDto["team"] }) {
  return (
    <table className="dash__table">
      <thead>
        <tr>
          <th>Vendedor</th>
          <th className="num">Chats</th>
          <th className="num">Cerrados</th>
          <th className="num">Esperando</th>
          <th className="num">1ª respuesta</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId ?? "none"}>
            <td className={r.userId ? "" : "dash__muted"}>{r.name}</td>
            <td className="num">{r.conversations}</td>
            <td className="num">{r.closed}</td>
            <td className="num">{r.awaiting > 0 ? <span className="dash__waiting">{r.awaiting}</span> : 0}</td>
            <td className="num">{duration(r.firstResponseSec)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CardHead({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="dash__title">
      <h2>
        <NavIcon name={icon} size={15} />
        {title}
      </h2>
      {hint && <span>{hint}</span>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="dash__empty">{text}</p>;
}

function Skeleton() {
  return (
    <div className="dash__body">
      <section className="dash__kpis">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 104, borderRadius: 12 }} />
        ))}
      </section>
      <div className="skeleton" style={{ height: 300, borderRadius: 14 }} />
    </div>
  );
}
