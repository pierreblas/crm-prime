"use client";

import { useId, useMemo, useRef, useState } from "react";

/**
 * Gráficos del panel, en SVG propio: pocos tipos, sin dependencias y con el
 * mismo lenguaje visual que el resto de Driony. Las etiquetas van en HTML, no
 * dentro del SVG, para que no se deformen al estirar el gráfico.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** "area" rellena bajo la línea; "line" solo traza. */
  kind?: "area" | "line";
}

const W = 1000;
const H = 220;

function axisLabels(days: string[]): { i: number; label: string }[] {
  if (!days.length) return [];
  const step = Math.max(1, Math.ceil(days.length / 6));
  const out: { i: number; label: string }[] = [];
  for (let i = 0; i < days.length; i += step) out.push({ i, label: shortDay(days[i]!) });
  return out;
}

export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Líneas / áreas por día, con guía y tooltip al pasar el ratón. */
export function TimeChart({
  days,
  series,
  format = (n) => n.toLocaleString("es"),
}: {
  days: string[];
  series: Series[];
  format?: (n: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = niceMax(max);
  const x = (i: number) => (days.length <= 1 ? W / 2 : (i / (days.length - 1)) * W);
  const y = (v: number) => H - (v / nice) * (H - 8);

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        const line = `M${pts.join(" L")}`;
        const area = `${line} L${x(s.values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
        return { ...s, line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, nice, days.length],
  );

  function onMove(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r || days.length === 0) return;
    const t = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(t * (days.length - 1)))));
  }

  return (
    <div className="chart">
      <div className="chart__plot" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <div className="chart__grid" aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <span key={f} style={{ bottom: `${f * 100}%` }}>
              <em>{format(Math.round(nice * f))}</em>
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={series.map((s) => s.label).join(", ")}>
          <defs>
            {paths.map((p) => (
              <linearGradient key={p.key} id={`${id}-${p.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={p.color} stopOpacity="0.35" />
                <stop offset="1" stopColor={p.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {paths.map((p) =>
            p.kind === "line" ? null : <path key={`a-${p.key}`} d={p.area} fill={`url(#${id}-${p.key})`} />,
          )}
          {paths.map((p) => (
            <path
              key={`l-${p.key}`}
              d={p.line}
              fill="none"
              stroke={p.color}
              strokeWidth={p.kind === "line" ? 2 : 2.5}
              strokeDasharray={p.kind === "line" ? "6 5" : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="rgba(205,225,200,.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hover !== null && (
          <div
            className="chart__tip"
            style={{ left: `${(days.length <= 1 ? 0.5 : hover / (days.length - 1)) * 100}%` }}
          >
            <strong>{shortDay(days[hover]!)}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}: {format(s.values[hover] ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="chart__axis">
        {axisLabels(days).map((a) => (
          <span key={a.i} style={{ left: `${(days.length <= 1 ? 0.5 : a.i / (days.length - 1)) * 100}%` }}>
            {a.label}
          </span>
        ))}
      </div>
      <Legend items={series} />
    </div>
  );
}

/** Barras por día, apiladas si hay varias series. */
export function StackedBars({
  days,
  series,
  format = (n) => n.toLocaleString("es"),
  axisFormat,
}: {
  days: string[];
  series: Series[];
  format?: (n: number) => string;
  /** Etiquetas del eje, más cortas que las del tooltip (p. ej. "2 mil"). */
  axisFormat?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const nice = niceMax(Math.max(1, ...totals));
  return (
    <div className="chart">
      <div className="chart__plot" onMouseLeave={() => setHover(null)}>
        <div className="chart__grid" aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <span key={f} style={{ bottom: `${f * 100}%` }}>
              <em>{(axisFormat ?? format)(Math.round(nice * f))}</em>
            </span>
          ))}
        </div>
        <div className="bars" role="img" aria-label={series.map((s) => s.label).join(", ")}>
          {days.map((d, i) => (
            <div key={d} className={`bars__col${hover === i ? " is-hover" : ""}`} onMouseEnter={() => setHover(i)}>
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                return v ? <span key={s.key} style={{ height: `${(v / nice) * 100}%`, background: s.color }} /> : null;
              })}
            </div>
          ))}
        </div>
        {hover !== null && (
          <div className="chart__tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <strong>{shortDay(days[hover]!)}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}: {format(s.values[hover] ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="chart__axis">
        {axisLabels(days).map((a) => (
          <span key={a.i} style={{ left: `${((a.i + 0.5) / days.length) * 100}%` }}>
            {a.label}
          </span>
        ))}
      </div>
      {series.length > 1 && <Legend items={series} />}
    </div>
  );
}

/** Barras horizontales con etiqueta y valor (ranking). */
export function HBars({ items, color = "var(--accent-2)" }: { items: { label: string; value: number; hint?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="hbars">
      {items.map((it) => (
        <li key={it.label}>
          <div className="hbars__row">
            <span className="hbars__label">{it.label}</span>
            <span className="hbars__value">
              {it.value.toLocaleString("es")}
              {total > 0 && <small> · {Math.round((it.value / total) * 100)} %</small>}
            </span>
          </div>
          <span className="hbars__track">
            <span style={{ transform: `scaleX(${it.value / max})`, background: color }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Embudo: cada etapa con su ancho proporcional y la conversión desde la anterior. */
export function Funnel({
  stages,
  money,
}: {
  stages: { id: string; name: string; count: number; value: number; isWon: boolean; isLost: boolean }[];
  money: (n: number) => string;
}) {
  const open = stages.filter((s) => !s.isLost);
  const max = Math.max(1, ...open.map((s) => s.count));
  return (
    <ol className="funnel">
      {open.map((s, i) => {
        // La conversión solo tiene sentido entre etapas abiertas: las ganadas se
        // acumulan, así que compararlas con la anterior daría más del 100 %.
        const prev = open[i - 1];
        const conv = !s.isWon && prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null;
        return (
          <li key={s.id} className={s.isWon ? "is-won" : ""}>
            <div className="funnel__bar" style={{ width: `${Math.max(6, (s.count / max) * 100)}%` }}>
              <span className="funnel__name">{s.name}</span>
            </div>
            <span className="funnel__stats">
              <strong>{s.count.toLocaleString("es")}</strong>
              {s.value > 0 && <small>{money(s.value)}</small>}
              {conv !== null && <small className="funnel__conv">{conv} % de la anterior</small>}
            </span>
          </li>
        );
      })}
      {stages
        .filter((s) => s.isLost)
        .map((s) => (
          <li key={s.id} className="is-lost">
            <span className="funnel__lost">
              {s.name}: <strong>{s.count.toLocaleString("es")}</strong>
            </span>
          </li>
        ))}
    </ol>
  );
}

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Mapa de calor semana × hora. Empieza en lunes, como se lee una agenda. */
export function Heatmap({ data }: { data: number[][] }) {
  const max = Math.max(1, ...data.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  const peak = (() => {
    let best = { d: 0, h: 0, v: -1 };
    data.forEach((row, d) => row.forEach((v, h) => (v > best.v ? (best = { d, h, v }) : null)));
    return best.v > 0 ? best : null;
  })();
  return (
    <div className="heat">
      <div className="heat__grid" role="img" aria-label="Mensajes de clientes por día y hora">
        {order.map((d) => (
          <div key={d} className="heat__row">
            <span className="heat__dow">{DOW[d]}</span>
            {data[d]!.map((v, h) => (
              <span
                key={h}
                className="heat__cell"
                style={{ background: v ? `rgba(200, 255, 0, ${0.12 + (v / max) * 0.88})` : undefined }}
                title={`${DOW[d]} ${String(h).padStart(2, "0")}:00 · ${v} mensajes`}
              />
            ))}
          </div>
        ))}
        <div className="heat__row heat__hours">
          <span className="heat__dow" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heat__h">
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
      {peak && (
        <p className="heat__peak">
          Hora pico: <strong>{DOW[peak.d]} de {String(peak.h).padStart(2, "0")}:00 a {String((peak.h + 1) % 24).padStart(2, "0")}:00</strong>
        </p>
      )}
    </div>
  );
}

function Legend({ items }: { items: { key: string; label: string; color: string; kind?: string }[] }) {
  return (
    <div className="chart__legend">
      {items.map((s) => (
        <span key={s.key}>
          <i className={s.kind === "line" ? "is-line" : ""} style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Tope "redondo" del eje: 1, 2, 5 × 10^n. */
function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
