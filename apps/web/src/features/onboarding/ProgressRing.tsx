/**
 * Anillo de progreso. Lo que va dentro (cifra, icono, foto) lo pone quien lo usa.
 * El trazo se anima al cambiar: completar un paso se ve, no solo se lee.
 *
 * Por defecto pinta el avance de la guía (lima, verde al completar). Quien mide
 * otra cosa pasa su color; quien no tiene nada que medir pasa `pct = null` y
 * queda solo la pista, que puede ir punteada.
 */
export function ProgressRing({
  pct,
  size,
  stroke = 3,
  color,
  track = "var(--surface-3)",
  trackDash,
  children,
  className,
}: {
  /** De 0 a 1. Null = sin arco. */
  pct: number | null;
  size: number;
  stroke?: number;
  color?: string;
  track?: string;
  /** Patrón de la pista («2 4»): un anillo que no mide un cupo. */
  trackDash?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = pct === null ? 0 : Math.max(0, Math.min(1, pct));
  return (
    <span className={`ring${className ? ` ${className}` : ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={track}
          strokeWidth={stroke}
          strokeDasharray={trackDash}
          fill="none"
        />
        {pct !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color ?? (clamped >= 1 ? "var(--positive)" : "var(--accent-2)")}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - clamped)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="ring__arc"
          />
        )}
      </svg>
      <span className="ring__inner">{children}</span>
    </span>
  );
}
