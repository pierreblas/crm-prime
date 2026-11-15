"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { aiIncludedTotal, formatTokens, aiQuotaLevel, type AiIncluded, type AiStatus } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { useAiStatus } from "@/features/copilot/useAiStatus";
import { ProgressRing } from "@/features/onboarding/ProgressRing";

/**
 * Lo que le queda a la empresa de la IA de Driony este mes, en la cabecera
 * junto a la foto: «Quedan 7,7 M». Cuenta tokens: es lo que el cliente compra,
 * y de ahí sale todo lo que hace la IA. Como una batería, la barra empieza
 * llena y se vacía; se pone ámbar al quedar el 20 % del total (cupo del plan
 * más tokens extra), más al 5 % y rojo al acabarse. Al pulsarlo dice cuánto
 * queda, cuánto se usó, cuándo vuelve y, a los administradores, cómo ampliarlo.
 *
 * Con clave propia (o la del servidor) Driony no pone límite: el mismo sitio
 * enseña lo gastado este mes y lo que cuesta a precio de lista.
 */
export function AiUsageMeter({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { data: ai } = useAiStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const included = usesIncluded(ai) ? ai!.included : null;
  const ownKey = !!ai && (ai.source === "own" || ai.source === "platform");
  if (!included && !ownKey) return null;

  if (!included) {
    // Sin límite de Driony: lo gastado este mes y, si lo paga la empresa, lo que cuesta.
    const n = formatTokens(ai!.ownTokens);
    const kind = keyKind(ai!);
    const label = kind === "platform" ? t("aiMeter.platformLabel", { n }) : t("aiMeter.ownLabel", { n });
    const title = kind === "platform" ? t("aiMeter.platformTitle") : kind === "server" ? t("aiMeter.serverTitle") : t("aiMeter.ownTitle");
    const cost = kind !== "platform" && ai!.ownCostUsd !== null && ai!.ownTokens > 0 ? usdOf(ai!.ownCostUsd, locale) : null;
    return (
      <div ref={ref} className="ai-meter-wrap">
        <button
          type="button"
          className="ai-meter is-own"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={() => setOpen((o) => !o)}
          data-ai-meter={kind === "platform" ? "platform" : "own"}
        >
          <NavIcon name={kind === "platform" ? "sparkles" : "key"} size={14} />
          <span className="ai-meter__text">
            {kind === "platform" ? t("aiMeter.platformChip", { n }) : t("aiMeter.ownChip", { n })}
          </span>
        </button>
        {open && (
          <div role="dialog" className="ai-meter__pop" aria-label={title}>
            <span className="ai-meter__eyebrow">{title}</span>
            <strong className="ai-meter__count">{t("aiMeter.ownCount", { n })}</strong>
            {cost && <span className="ai-meter__extra">{t("aiMeter.ownCost", { usd: cost })}</span>}
            <p className="ai-meter__status">
              {kind === "platform" ? t("aiMeter.platformStatus") : kind === "server" ? t("aiMeter.serverStatus") : t("aiMeter.ownStatus")}
            </p>
            <div className="ai-meter__actions">
              <Link href="/settings?tab=aiUsage" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
                {t("aiMeter.usage")}
              </Link>
              {isAdmin && (
                <Link href="/settings?tab=ai" className="ai-meter__link" onClick={() => setOpen(false)}>
                  {t("aiMeter.ownKeySettings")}
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const m = meterOf(included);
  const fmt = (n: number) => formatTokens(n);
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" });
  const level = aiQuotaLevel(included);
  const resets = day(included.resetsAt);
  const status = included.exhausted
    ? t("aiMeter.exhausted", { date: resets })
    : level === "full"
      ? t("aiMeter.full", { date: resets })
      : level === "high"
        ? t("aiMeter.high", { date: resets })
        : level === "warn"
          ? t("aiMeter.warn")
          : t("aiMeter.ok", { date: resets });

  return (
    <div ref={ref} className="ai-meter-wrap">
      <button
        type="button"
        className={`ai-meter is-${level}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("aiMeter.label", { left: fmt(m.left), total: fmt(m.total) })}
        title={t("aiMeter.label", { left: fmt(m.left), total: fmt(m.total) })}
        onClick={() => setOpen((o) => !o)}
        data-ai-meter={level}
      >
        <NavIcon name={level === "full" ? "alert" : "sparkles"} size={14} />
        <span className="ai-meter__text">{t("aiMeter.chip", { left: fmt(m.left) })}</span>
        <span className="ai-meter__bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${m.leftPct})` }} />
        </span>
      </button>
      {open && (
        <div role="dialog" className="ai-meter__pop" aria-label={t("aiMeter.title")}>
          <span className="ai-meter__eyebrow">{t("aiMeter.title")}</span>
          <strong className="ai-meter__count">{t("aiMeter.count", { left: fmt(m.left), total: fmt(m.total) })}</strong>
          <span className={`ai-meter__track is-${level}`} aria-hidden="true">
            <i style={{ transform: `scaleX(${m.leftPct})` }} />
          </span>
          <span className="ai-meter__extra">{t("aiMeter.used", { used: fmt(m.used), date: resets })}</span>
          {included.extraRemaining + included.extraUsed > 0 && (
            <span className="ai-meter__extra">
              {included.extraRemaining > 0 && included.extraExpiresAt
                ? t("aiMeter.extra", { n: fmt(included.extraRemaining + included.extraUsed), date: day(included.extraExpiresAt) })
                : t("aiMeter.extraUsed", { n: fmt(included.extraUsed) })}
            </span>
          )}
          <p className="ai-meter__status">{status}</p>
          {isAdmin ? (
            <div className="ai-meter__actions">
              <Link href="/settings?tab=plan#extra" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
                {t("aiMeter.buyExtra")}
              </Link>
              <Link href="/settings?tab=ai" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                {t("aiMeter.ownKey")}
              </Link>
              <Link href="/settings?tab=aiUsage" className="ai-meter__link" onClick={() => setOpen(false)}>
                {t("aiMeter.usage")}
              </Link>
            </div>
          ) : (
            <p className="ai-meter__hint">{t("aiMeter.askAdmin")}</p>
          )}
        </div>
      )}
    </div>
  );
}

const RING_SIZE = 36;
const RING_STROKE = 2;
/** Cian mide; el ámbar y el rojo son los mismos avisos del medidor. */
const RING_COLOR = { ok: "var(--cyan)", warn: "var(--warning)", high: "var(--warning)", full: "var(--danger)" } as const;

/**
 * La foto de la cabecera con lo que queda de la IA de Driony alrededor: el
 * anillo empieza lleno el día 1 y se vacía con los tokens gastados, como la
 * barra del medidor y el anillo del copiloto. Con clave propia Driony no pone
 * límite, así que no hay nada que vaciar: la foto va sola (antes iba un anillo
 * punteado que no decía nada) y la cifra está en el medidor de al lado, que
 * además es el que lee un lector de pantalla. Sin IA, también la foto sola.
 */
export function AiUsageRing({ initial }: { initial: string }) {
  const t = useT();
  const { data: ai } = useAiStatus();
  const included = usesIncluded(ai) ? ai!.included : null;
  const photo = <span className="avatar user-ring__photo">{initial}</span>;

  if (included) {
    const m = meterOf(included);
    const level = aiQuotaLevel(included);
    return (
      <span
        className="user-ring"
        title={t("aiMeter.label", { left: formatTokens(m.left), total: formatTokens(m.total) })}
        data-ai-ring={level}
      >
        <ProgressRing pct={m.leftPct} size={RING_SIZE} stroke={RING_STROKE} color={RING_COLOR[level]} track="var(--border-strong)">
          {photo}
        </ProgressRing>
      </span>
    );
  }
  return (
    <span className="user-ring" data-ai-ring={ai && (ai.source === "own" || ai.source === "platform") ? "own" : "none"}>
      {photo}
    </span>
  );
}

/**
 * Aviso para los administradores al 80 %, al 95 % y al llegar al tope, debajo de la
 * cabecera y en todas las pantallas. Se cierra una vez por nivel y por mes (en
 * este navegador): avisa, no persigue. El medidor sigue a la vista.
 */
export function AiQuotaNotice({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const { data: ai } = useAiStatus();
  const included = usesIncluded(ai) ? ai!.included : null;
  const level = included ? aiQuotaLevel(included) : "ok";
  const key = included ? `ai-quota-notice:${included.resetsAt.slice(0, 7)}:${level}` : "";
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!key) return;
    try {
      setDismissed(window.localStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);

  if (!isAdmin || !included || level === "ok" || dismissed) return null;
  const m = meterOf(included);
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Sin almacenamiento, el aviso vuelve en la próxima carga: mejor que no avisar.
    }
  };

  return (
    <div className={`ai-notice is-${level}`} role="status" data-ai-notice={level}>
      <NavIcon name={level === "full" ? "alert" : "sparkles"} size={16} />
      <span className="ai-notice__text">
        <strong>
          {level === "full"
            ? t("aiMeter.noticeFull")
            : t("aiMeter.noticeWarn", { left: formatTokens(m.left), pct: Math.floor(m.leftPct * 100) })}
        </strong>{" "}
        {t("aiMeter.noticeBody")}
      </span>
      <Link href="/settings?tab=plan#extra" className="btn btn-primary btn-sm">
        {t("aiMeter.buyExtra")}
      </Link>
      <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
        {t("aiMeter.noticeDismiss")}
      </button>
    </div>
  );
}

/**
 * ¿Esta empresa gasta la IA de Driony? Con ella activa, o sin clave propia y con
 * el tope en dólares alcanzado (entonces el medidor dice por qué no responde).
 */
function usesIncluded(ai: AiStatus | undefined): boolean {
  return !!ai?.included && (ai.source === "included" || (ai.source === "none" && ai.included.exhausted));
}

/**
 * Lo gastado y lo que queda frente a todo lo que hay este mes: el cupo del plan
 * más los tokens extra. `leftPct` es lo que pintan la barra y el anillo.
 */
export function meterOf(i: AiIncluded): { used: number; left: number; total: number; pct: number; leftPct: number } {
  const total = aiIncludedTotal(i);
  const used = Math.min(i.tokens, total);
  const pct = total > 0 ? Math.min(1, used / total) : 1;
  return { used, left: Math.max(0, total - used), total, pct, leftPct: 1 - pct };
}

/**
 * De quién es la clave sin límite: la de la empresa, la del servidor en una
 * instalación propia (la paga quien la instaló) o la que presta la plataforma
 * en SaaS (la paga Driony, así que no se enseña un coste).
 */
export function keyKind(ai: AiStatus): "own" | "server" | "platform" {
  if (ai.source === "platform") return ai.saas ? "platform" : "server";
  return "own";
}

/** USD aproximado, con dos decimales: va detrás de «≈», así que un céntimo de mínimo basta. */
export function usdOf(n: number, locale: string): string {
  return Math.max(n, 0.01).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
