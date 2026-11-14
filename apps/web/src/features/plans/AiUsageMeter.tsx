"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { aiIncludedTotal, formatTokens, aiQuotaLevel, type AiIncluded, type AiStatus } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { useAiStatus } from "@/features/copilot/useAiStatus";
import { ProgressRing } from "@/features/onboarding/ProgressRing";

/**
 * Lo que lleva gastado la empresa de la IA de Driony este mes, en la cabecera
 * junto a la foto: «IA 1,2 M/2,5 M». Cuenta tokens: es lo que el cliente
 * compra, y de ahí sale todo lo que hace la IA. Se pone ámbar al 80 % del
 * total (cupo del plan más tokens extra), más al 95 % y rojo al llegar. Al pulsarlo explica qué pasa al
 * tope y, a los administradores, cómo ampliarlo.
 *
 * Con clave propia (o la del servidor) no hay cupo, pero el mismo sitio enseña
 * lo gastado este mes («IA 14 mil»): siempre se sabe cuánta IA va.
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
    // Clave propia: lo gastado este mes, sin cupo ni barra.
    const n = formatTokens(ai!.ownTokens);
    return (
      <div ref={ref} className="ai-meter-wrap">
        <button
          type="button"
          className="ai-meter is-own"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("aiMeter.ownLabel", { n })}
          title={t("aiMeter.ownLabel", { n })}
          onClick={() => setOpen((o) => !o)}
          data-ai-meter="own"
        >
          <NavIcon name="sparkles" size={14} />
          <span className="ai-meter__text">{t("aiMeter.ownChip", { n })}</span>
        </button>
        {open && (
          <div role="dialog" className="ai-meter__pop" aria-label={t("aiMeter.ownTitle")}>
            <span className="ai-meter__eyebrow">{t("aiMeter.ownTitle")}</span>
            <strong className="ai-meter__count">{t("aiMeter.ownCount", { n })}</strong>
            <p className="ai-meter__status">{t("aiMeter.ownStatus")}</p>
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
        aria-label={t("aiMeter.label", { used: fmt(m.used), total: fmt(m.total) })}
        title={t("aiMeter.label", { used: fmt(m.used), total: fmt(m.total) })}
        onClick={() => setOpen((o) => !o)}
        data-ai-meter={level}
      >
        <NavIcon name={level === "full" ? "alert" : "sparkles"} size={14} />
        <span className="ai-meter__text">{t("aiMeter.chip", { used: fmt(m.used), total: fmt(m.total) })}</span>
        <span className="ai-meter__bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${m.pct})` }} />
        </span>
      </button>
      {open && (
        <div role="dialog" className="ai-meter__pop" aria-label={t("aiMeter.title")}>
          <span className="ai-meter__eyebrow">{t("aiMeter.title")}</span>
          <strong className="ai-meter__count">{t("aiMeter.count", { used: fmt(m.used), total: fmt(m.total) })}</strong>
          <span className={`ai-meter__track is-${level}`} aria-hidden="true">
            <i style={{ transform: `scaleX(${m.pct})` }} />
          </span>
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
/** Pista punteada en 18 tramos iguales: sin costura donde el círculo se cierra. */
const RING_STEP = (2 * Math.PI * ((RING_SIZE - RING_STROKE) / 2)) / 18;
const RING_DOTS = `${(RING_STEP * 0.38).toFixed(3)} ${(RING_STEP * 0.62).toFixed(3)}`;
/** Cian mide; el ámbar y el rojo son los mismos avisos del medidor. */
const RING_COLOR = { ok: "var(--cyan)", warn: "var(--warning)", high: "var(--warning)", full: "var(--danger)" } as const;

/**
 * La foto de la cabecera con el consumo de IA alrededor: el anillo se llena con
 * los tokens de Driony gastados este mes. Con clave propia no hay cupo que
 * llenar: el anillo va punteado y la cifra del mes sale al pasar el cursor. Sin
 * IA, la foto sola. El detalle y las acciones siguen en el medidor de al lado,
 * que además es el que lee un lector de pantalla.
 */
export function AiUsageRing({ initial }: { initial: string }) {
  const t = useT();
  const { data: ai } = useAiStatus();
  const included = usesIncluded(ai) ? ai!.included : null;
  const ownKey = !included && !!ai && (ai.source === "own" || ai.source === "platform");
  const photo = <span className="avatar user-ring__photo">{initial}</span>;

  if (included) {
    const m = meterOf(included);
    const level = aiQuotaLevel(included);
    return (
      <span
        className="user-ring"
        title={t("aiMeter.label", { used: formatTokens(m.used), total: formatTokens(m.total) })}
        data-ai-ring={level}
      >
        <ProgressRing pct={m.pct} size={RING_SIZE} stroke={RING_STROKE} color={RING_COLOR[level]}>
          {photo}
        </ProgressRing>
      </span>
    );
  }
  if (ownKey) {
    return (
      <span className="user-ring" title={t("aiMeter.ownLabel", { n: formatTokens(ai!.ownTokens) })} data-ai-ring="own">
        <ProgressRing pct={null} size={RING_SIZE} stroke={RING_STROKE} track="var(--border-strong)" trackDash={RING_DOTS}>
          {photo}
        </ProgressRing>
      </span>
    );
  }
  return (
    <span className="user-ring" data-ai-ring="none">
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
        <strong>{level === "full" ? t("aiMeter.noticeFull") : t("aiMeter.noticeWarn", { pct: Math.floor(m.pct * 100) })}</strong>{" "}
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

/** Lo gastado frente a todo lo que hay este mes: el cupo del plan más los tokens extra. */
function meterOf(i: AiIncluded): { used: number; total: number; pct: number } {
  const total = aiIncludedTotal(i);
  const used = Math.min(i.tokens, total);
  return { used, total, pct: total > 0 ? Math.min(1, used / total) : 1 };
}
