"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { aiQuotaLevel, formatTokens, type AiUsagePeriod, type AiUsageReport } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { fetchAiUsage } from "@/lib/bff";
import { useAiStatus } from "@/features/copilot/useAiStatus";
import { keyKind, meterOf, usdOf } from "@/features/plans/AiUsageMeter";

const PERIODS: { key: AiUsagePeriod; label: string }[] = [
  { key: "month", label: "Este mes" },
  { key: "last_month", label: "Mes pasado" },
  { key: "30d", label: "Últimos 30 días" },
];

// Con poco uso los importes son de milésimas: se enseñan con más decimales
// en vez de un "< USD 0,01" que no dice nada.
const usd = (n: number) => {
  if (n === 0) return "USD 0";
  if (n < 0.0001) return "< USD 0,0001";
  const digits = n < 1 ? 4 : 2;
  return `USD ${n.toLocaleString("es", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
const num = (n: number) => n.toLocaleString("es");
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("es", { maximumFractionDigits: 1 })} M` : n >= 1000 ? `${(n / 1000).toLocaleString("es", { maximumFractionDigits: 1 })} mil` : num(n);

/**
 * Ajustes › Consumo de IA: cuántos tokens gasta la empresa, en qué y cuánto le
 * cuesta. Con su clave, la paga a su proveedor y esto es una estimación con
 * precios de lista. Lo que corre con la IA incluida en su plan no le cuesta
 * nada aparte: se enseña como consumo, sin precio, para que no parezca deuda.
 */
export function AiUsageSettings() {
  const [period, setPeriod] = useState<AiUsagePeriod>("month");
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["ai-usage", period],
    queryFn: () => fetchAiUsage(period),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="usage">
      <header className="usage__head">
        <div>
          <h3>Consumo de IA</h3>
          <p>
            Cuántos tokens gasta la IA de tu empresa y en qué. La IA incluida en tu plan no te cuesta nada aparte
            mientras te queden tokens; con tu propia clave, lo pagas directamente a tu proveedor.
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Periodo">
          {PERIODS.map((p) => (
            <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <MonthCounter />

      {isError && (
        <p style={{ color: "var(--danger)" }}>
          No se pudo cargar el consumo.{" "}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {isPending && <div className="skeleton" style={{ height: 260, borderRadius: "var(--r-lg)" }} />}
      {data && <Report data={data} />}
    </div>
  );
}

/**
 * El contador del mes, encima del informe: lo que te queda de la IA de Driony
 * (como la ficha de la cabecera y el círculo de tu foto) o, con tu clave, lo que
 * llevas y lo que cuesta, que Driony no limita. No depende del periodo elegido.
 */
function MonthCounter() {
  const { data: ai } = useAiStatus();
  if (!ai) return null;
  const date = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "UTC" });

  const included = ai.included && (ai.source === "included" || (ai.source === "none" && ai.included.exhausted)) ? ai.included : null;
  if (included) {
    const m = meterOf(included);
    const level = aiQuotaLevel(included);
    return (
      <section className={`usage__counter is-${level}`} data-usage-counter={level}>
        <div className="usage__counter-main">
          <span>Tokens de IA de Driony · este mes</span>
          <strong>
            Te quedan {formatTokens(m.left)} <small>de {formatTokens(m.total)}</small>
          </strong>
          <span className="usage__counter-track" aria-hidden="true">
            <i style={{ transform: `scaleX(${m.leftPct})` }} />
          </span>
          <small>
            Usados: {formatTokens(m.used)} · se recargan el {date(included.resetsAt)}. La ficha de arriba y el círculo
            de tu foto muestran lo mismo: llenos al empezar el mes, se vacían a medida que la IA trabaja.
          </small>
        </div>
        <Link href="/settings?tab=plan#extra" className="btn btn-ghost btn-sm">
          Tokens extra
        </Link>
      </section>
    );
  }

  if (ai.source !== "own" && ai.source !== "platform") return null;
  const kind = keyKind(ai);
  const cost = kind !== "platform" && ai.ownCostUsd !== null && ai.ownTokens > 0 ? usdOf(ai.ownCostUsd, "es") : null;
  return (
    <section className="usage__counter is-own" data-usage-counter={kind}>
      <div className="usage__counter-main">
        <span>
          {kind === "platform" ? "IA del servidor de Driony" : kind === "server" ? "IA con la clave del servidor" : "IA con tu propia clave"}{" "}
          · este mes
        </span>
        <strong>
          {formatTokens(ai.ownTokens)} tokens usados {cost && <small>≈ USD {cost}</small>}
        </strong>
        <small>
          {kind === "platform"
            ? "Driony no le pone límite de tokens. Cada agente conserva su tope mensual."
            : "Sin límite de Driony: lo paga tu proveedor directamente. Para frenar el gasto, pon un tope mensual a cada agente."}
        </small>
      </div>
      <Link href="/agentes" className="btn btn-ghost btn-sm">
        Topes por agente
      </Link>
    </section>
  );
}

/**
 * Las preguntas gratis del copiloto del administrador: las paga Driony, así que
 * no están en el informe. Se dicen en una línea para que nadie piense que faltan.
 */
function CourtesyNote({ data }: { data: AiUsageReport }) {
  if (!data.courtesy.questions) return null;
  const n = data.courtesy.questions;
  return (
    <p className="usage__courtesy" data-usage-courtesy>
      <NavIcon name="sparkles" size={14} />
      <span>
        <strong>
          {num(n)} {n === 1 ? "pregunta gratis" : "preguntas gratis"} al copiloto
        </strong>{" "}
        en este periodo. Las paga Driony: no gastan tus tokens ni tu clave, y por eso no aparecen abajo.
      </span>
    </p>
  );
}

function Report({ data }: { data: AiUsageReport }) {
  const { total } = data;
  const tokens = total.inputTokens + total.outputTokens;

  if (total.calls === 0) {
    return (
      <>
        <CourtesyNote data={data} />
        <div className="usage__empty">
          <NavIcon name="bolt" size={22} />
          <strong>Sin consumo en este periodo</strong>
          <span>Cuando el agente responda o uses el copiloto, lo verás aquí con su coste.</span>
        </div>
      </>
    );
  }

  const maxDay = Math.max(1, ...data.byDay.map((d) => d.tokens));
  const own = data.bySource.own;
  const included = data.bySource.platform;
  // Todo con la IA incluida: no hay nada que pagar, así que no se enseñan precios.
  const onlyIncluded = included.calls > 0 && own.calls === 0;
  const mixed = included.calls > 0 && own.calls > 0;
  const costHead = mixed ? "Coste de lista" : "Coste";

  return (
    <>
      <CourtesyNote data={data} />
      <section className="usage__kpis">
        {onlyIncluded ? (
          <div className="usage__kpi is-main">
            <span>IA incluida en tu plan</span>
            <strong>Sin costo</strong>
            <small>Todo corrió con la IA incluida en tu plan</small>
          </div>
        ) : mixed ? (
          <div className="usage__kpi is-main">
            <span>Con tu clave</span>
            <strong>{usd(own.costUsd)}</strong>
            <small>Lo pagas a tu proveedor. {num(included.calls)} llamadas fueron con la IA incluida, sin costo</small>
          </div>
        ) : (
          <div className="usage__kpi is-main">
            <span>Coste estimado</span>
            <strong>{usd(total.costUsd)}</strong>
            {total.unpriced && <small>Sin contar modelos sin precio conocido</small>}
          </div>
        )}
        <div className="usage__kpi">
          <span>Tokens</span>
          <strong>{compact(tokens)}</strong>
          <small>
            {compact(total.inputTokens)} de entrada · {compact(total.outputTokens)} de salida
          </small>
        </div>
        <div className="usage__kpi">
          <span>Llamadas a la IA</span>
          <strong>{num(total.calls)}</strong>
          <small>{total.calls ? `${compact(Math.round(tokens / total.calls))} tokens de media` : ""}</small>
        </div>
      </section>

      <section className="usage__panel">
        <h4>Por día</h4>
        <div className="usage__chart" role="img" aria-label="Tokens por día">
          {data.byDay.map((d) => (
            <span
              key={d.day}
              className={`usage__bar${d.tokens ? " has-value" : ""}`}
              style={{ height: `${Math.max(3, (d.tokens / maxDay) * 100)}%` }}
              title={`${new Date(`${d.day}T12:00:00Z`).toLocaleDateString("es", { day: "numeric", month: "short" })}: ${num(d.tokens)} tokens${onlyIncluded ? "" : ` · ${usd(d.costUsd)}`}`}
            />
          ))}
        </div>
      </section>

      <div className="usage__grid">
        <section className="usage__panel">
          <h4>En qué se gasta</h4>
          <table className="usage__table">
            <thead>
              <tr>
                <th>Función</th>
                <th className="num">Llamadas</th>
                <th className="num">Tokens</th>
                {!onlyIncluded && <th className="num">{costHead}</th>}
              </tr>
            </thead>
            <tbody>
              {data.byFeature.map((f) => (
                <tr key={f.feature}>
                  <td>
                    <span className="usage__label">{f.label}</span>
                    <span className="usage__share">
                      <span style={{ transform: `scaleX(${tokens ? (f.inputTokens + f.outputTokens) / tokens : 0})` }} />
                    </span>
                  </td>
                  <td className="num">{num(f.calls)}</td>
                  <td className="num">{compact(f.inputTokens + f.outputTokens)}</td>
                  {!onlyIncluded && <td className="num">{usd(f.costUsd)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="usage__panel">
          <h4>Por modelo</h4>
          <table className="usage__table">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Tokens</th>
                {!onlyIncluded && <th className="num">{costHead}</th>}
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => (
                <tr key={m.model}>
                  <td>
                    <code>{m.model}</code>
                  </td>
                  <td className="num">{compact(m.inputTokens + m.outputTokens)}</td>
                  {!onlyIncluded && (
                    <td className="num">{m.priced ? usd(m.costUsd) : <span className="usage__muted">sin precio</span>}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {onlyIncluded ? (
        <p className="usage__note">
          Todo este consumo corrió con la IA incluida en tu plan: no te cuesta nada aparte. Lo que cuenta es cuántos
          tokens te quedan este mes (arriba); para sumar más, ve a <Link href="/settings?tab=plan#extra">Ajustes › Plan</Link>.
          Si conectas tu propia clave, aquí verás lo que te cobraría tu proveedor.
        </p>
      ) : (
        <p className="usage__note">
          Coste estimado con los precios de lista de cada proveedor (revisados en {data.pricesReviewed}). Tu factura
          real está en tu cuenta de OpenAI o Anthropic.
          {mixed && " Las columnas de coste incluyen, como referencia, lo que corrió con la IA incluida en tu plan, que no pagas."}{" "}
          Para poner un tope mensual a un agente, ve a <Link href="/agentes">Agentes IA</Link> › Modelo y gasto.
        </p>
      )}
    </>
  );
}
