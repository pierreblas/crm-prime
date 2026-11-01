"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  AI_PACKS,
  AI_PACK_MONTHS,
  FEATURE_LABELS,
  PLAN_FEATURES,
  TRIAL_AI_CONVERSATIONS,
  formatAiIncluded,
  formatPlanPrice,
  formatRetention,
  planWithFeature,
  type MyPlanDto,
  type PlanDef,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useMyPlan } from "./usePlan";

/**
 * Ajustes › Plan: qué plan tiene la empresa, cuánto lleva usado y qué
 * incluye cada uno. No hay cobro automático: cambiar de plan es escribir al
 * operador, que lo hace desde la consola de plataforma.
 *
 * Durante la prueba del alta el plan que se ve es el que se prueba (Pro), con
 * los días que quedan; al terminar, un aviso de que sigue en Gratis.
 *
 * Con IA incluida, debajo van las conversaciones extra (#extra, adonde lleva
 * el medidor de la cabecera): las que tiene y los paquetes que puede pedir.
 */
export function PlanSettings() {
  const { data, isPending, isError, refetch } = useMyPlan();

  // El medidor de la cabecera enlaza a #extra, que no existe hasta que carga el plan.
  useEffect(() => {
    if (data && window.location.hash === "#extra") {
      document.getElementById("extra")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [data]);

  if (isPending) {
    return (
      <div className="plan">
        <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
        <div className="skeleton" style={{ height: 220, marginTop: 14 }} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="plan">
        <p style={{ color: "var(--danger)" }}>No se pudo cargar tu plan.</p>
        <button type="button" className="btn btn-ghost" onClick={() => void refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!data.saas) {
    return (
      <div className="plan">
        <header className="plan-head">
          <h3>Plan</h3>
          <p>
            Instalación propia: no hay planes ni límites. Todo lo que hay en Driony está
            disponible, con tus claves y en tu servidor.
          </p>
        </header>
      </div>
    );
  }

  const { plan, usage, plans, trial } = data;
  const trialing = !!trial?.active;
  const subject = encodeURIComponent(
    trialing ? `Quiero quedarme con ${plan.name} (estoy en la prueba)` : `Cambio de plan (ahora: ${plan.name})`,
  );

  return (
    <div className="plan">
      <header className="plan-head">
        <h3>Tu plan</h3>
        <p>
          Los límites se aplican al añadir números o usuarios; lo que ya tienes no se
          toca. Para cambiar de plan, escríbenos y lo activamos el mismo día.
        </p>
      </header>

      {trial && <TrialNotice trial={trial} />}

      <section className="plan-current">
        <div className="plan-current__head">
          <div>
            <span className="plan-current__name">{plan.name}</span>
            <span className="plan-current__price">
              {trialing ? `Prueba gratis hasta el ${longDate(trial!.endsAt)}` : formatPlanPrice(plan)}
            </span>
            <p className="plan-current__tagline">{plan.tagline}</p>
          </div>
          {data.contactEmail && (
            <a className="btn btn-primary" href={`mailto:${data.contactEmail}?subject=${subject}`}>
              {trialing ? `Quedarme con ${plan.name}` : "Cambiar de plan"}
            </a>
          )}
        </div>

        <div className="plan-usage">
          <Usage label="Números de WhatsApp" used={usage.numbers} limit={plan.limits.numbers} />
          <Usage label="Usuarios del equipo" used={usage.users} limit={plan.limits.users} />
          <Usage label="Contactos" used={usage.contacts} limit={plan.limits.contacts} />
          <Usage label="Oportunidades abiertas" used={usage.deals} limit={plan.limits.deals} />
          <Usage label="Contactos activos este mes" used={usage.activeContacts} limit={plan.limits.activeContacts} />
          {plan.aiConversations !== null && (
            <Usage label="Conversaciones con IA incluida este mes" used={usage.aiConversations} limit={plan.aiConversations} />
          )}
        </div>
        <p className="plan-fairuse">
          Contactos, oportunidades y contactos activos son de <strong>uso razonable</strong>: quien te escribe por
          WhatsApp entra siempre; al tope se frena crear o importar a mano. Si superas los activos del mes de forma
          sostenida, te propondremos el plan que te corresponde. {formatRetention(plan.mediaRetentionDays)}.
          {plan.aiConversations !== null && (
            <>
              {" "}
              La IA incluida cuenta conversaciones atendidas, no mensajes: al llegar al cupo, el agente termina
              las que ya atendía y los chats nuevos pasan a tu equipo hasta el día 1. Con tu propia clave de IA no
              hay cupo.
            </>
          )}
        </p>

        <ul className="plan-features">
          {PLAN_FEATURES.map((f) => (
            <li key={f} className={plan.features[f] ? "is-on" : "is-off"}>
              <NavIcon name={plan.features[f] ? "check" : "lock"} size={14} />
              {FEATURE_LABELS[f]}
            </li>
          ))}
        </ul>
      </section>

      {plan.aiConversations !== null && <AiExtra packs={data.aiPacks} contactEmail={data.contactEmail} />}

      <section>
        <h4 className="plan-all__title">Todos los planes</h4>
        <div className="plan-grid">
          {plans.map((p) => (
            <PlanCard key={p.key} plan={p} current={p.key === plan.key} trialing={trialing} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** "14 de noviembre". */
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long" });
}

/** El aviso ya terminado se enseña dos semanas; después la prueba es historia. */
const ENDED_NOTICE_MS = 14 * 86_400_000;

function TrialNotice({ trial }: { trial: NonNullable<MyPlanDto["trial"]> }) {
  if (trial.active) {
    const left = trial.daysLeft === 1 ? "es tu último día" : `te quedan ${trial.daysLeft} días`;
    return (
      <section className={`plan-trial${trial.daysLeft <= 3 ? " is-ending" : ""}`} role="status">
        <span className="plan-trial__icon" aria-hidden="true">
          <NavIcon name="sparkles" size={18} />
        </span>
        <div className="plan-trial__text">
          <strong>
            Estás probando {trial.planName}: {left}
          </strong>
          <span>
            Tienes todo {trial.planName} hasta el {longDate(trial.endsAt)}, con{" "}
            {TRIAL_AI_CONVERSATIONS.toLocaleString("es")} conversaciones con IA para probar el agente. Al terminar
            sigues en Gratis sin perder nada: tus chats, contactos y agentes se quedan como están.
          </span>
        </div>
      </section>
    );
  }
  if (Date.now() - new Date(trial.endsAt).getTime() > ENDED_NOTICE_MS) return null;
  return (
    <section className="plan-trial is-ended" role="status">
      <span className="plan-trial__icon" aria-hidden="true">
        <NavIcon name="check" size={18} />
      </span>
      <div className="plan-trial__text">
        <strong>
          Tu prueba de {trial.planName} terminó el {longDate(trial.endsAt)}
        </strong>
        <span>
          Sigues en Gratis y no se borró nada. Lo que ya tenías por encima de los límites se queda; lo que se frena es
          añadir más. La coexistencia vuelve desde {planWithFeature("coexistence")?.name}; difusiones y API, con{" "}
          {planWithFeature("broadcasts")?.name}.
        </span>
      </div>
    </section>
  );
}

/**
 * Conversaciones extra: para el mes que se queda corto, sin cambiar de plan.
 * Sin cobro en línea todavía: se piden por correo y el operador las añade
 * desde la consola al recibir el pago.
 */
function AiExtra({ packs, contactEmail }: { packs: MyPlanDto["aiPacks"]; contactEmail: string | null }) {
  const left = packs.reduce((n, p) => n + Math.max(0, p.conversations - p.used), 0);
  return (
    <section className="plan-extra" id="extra" data-ai-extra>
      <h4 className="plan-all__title">Conversaciones extra con IA</h4>
      <p className="plan-extra__lede">
        Para el mes que se te queda corto, sin cambiar de plan. Se pagan una vez, valen {AI_PACK_MONTHS} meses y se
        gastan solo cuando se acaba el cupo de tu plan, igual que él: una por conversación atendida al mes, no por
        mensaje. Con <Link href="/settings?tab=ai">tu propia clave de IA</Link> no hay cupo.
      </p>

      {packs.length > 0 && (
        <ul className="plan-extra__mine" aria-label="Tus conversaciones extra">
          {packs.map((p) => {
            const rest = Math.max(0, p.conversations - p.used);
            return (
              <li key={p.id} className={rest === 0 ? "is-spent" : ""}>
                <NavIcon name="sparkles" size={13} />
                <span>
                  <strong>{rest.toLocaleString("es")}</strong> de {p.conversations.toLocaleString("es")} conversaciones
                </span>
                <span className="plan-extra__when">{rest === 0 ? "Gastado" : `Vence el ${longDate(p.expiresAt)}`}</span>
              </li>
            );
          })}
        </ul>
      )}
      {packs.length > 0 && left === 0 && (
        <p className="plan-fairuse">Gastaste todas tus conversaciones extra: los chats nuevos pasan a tu equipo al llegar al cupo.</p>
      )}

      <div className="plan-extra__offers">
        {AI_PACKS.map((o) => {
          const subject = encodeURIComponent(`Conversaciones extra: ${o.conversations.toLocaleString("es")} (USD ${o.priceUsd})`);
          return (
            <div className="plan-extra__offer" key={o.key}>
              <span className="plan-extra__n">+{o.conversations.toLocaleString("es")}</span>
              <span className="plan-extra__what">
                conversaciones con IA
                <small>
                  USD {o.priceUsd}, una vez · USD {((o.priceUsd / o.conversations) * 1000).toLocaleString("es", { maximumFractionDigits: 2 })} cada mil
                </small>
              </span>
              {contactEmail && (
                <a className="btn btn-ghost btn-sm" href={`mailto:${contactEmail}?subject=${subject}`}>
                  Pedir
                </a>
              )}
            </div>
          );
        })}
      </div>
      <p className="plan-fairuse">
        Todavía no hay pago en línea: pídelas y te enviamos cómo pagar. Las activamos el mismo día y aparecen aquí y
        en el medidor de la cabecera.
      </p>
    </section>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(1, used / limit) : 0;
  return (
    <div className="plan-usage__row">
      <span className="plan-usage__label">{label}</span>
      <span className="plan-usage__num">
        {used}
        {limit !== null ? ` / ${limit}` : " · sin límite"}
      </span>
      {limit !== null && (
        <span className="plan-usage__bar" aria-hidden="true">
          <span className={pct >= 1 ? "is-full" : ""} style={{ transform: `scaleX(${pct})` }} />
        </span>
      )}
    </div>
  );
}

function PlanCard({ plan, current, trialing }: { plan: PlanDef; current: boolean; trialing: boolean }) {
  const lim = (n: number | null, one: string, many: string) =>
    n === null ? `${many} sin límite` : `${n} ${n === 1 ? one : many}`;
  return (
    <article className={`plan-card${current ? " is-current" : ""}`}>
      <div className="plan-card__head">
        <span className="plan-card__name">{plan.name}</span>
        {current && <span className="plan-card__badge">{trialing ? "En prueba" : "Tu plan"}</span>}
      </div>
      <span className="plan-card__price">{formatPlanPrice(plan)}</span>
      <p className="plan-card__tagline">{plan.tagline}</p>
      <ul className="plan-card__rows">
        <li>
          <NavIcon name="whatsapp" size={13} />
          {lim(plan.limits.numbers, "número de WhatsApp", "números de WhatsApp")}
        </li>
        <li>
          <NavIcon name="user" size={13} />
          {lim(plan.limits.users, "usuario", "usuarios")}
        </li>
        <li>
          <NavIcon name="user" size={13} />
          {lim(plan.limits.contacts, "contacto", "contactos")}
        </li>
        <li>
          <NavIcon name="pipeline" size={13} />
          {lim(plan.limits.deals, "oportunidad abierta", "oportunidades abiertas")}
        </li>
        <li>
          <NavIcon name="message" size={13} />
          {lim(plan.limits.activeContacts, "contacto activo al mes", "contactos activos al mes")}
        </li>
        {plan.aiConversations !== null && (
          <li>
            <NavIcon name="sparkles" size={13} />
            {formatAiIncluded(plan.aiConversations)}
          </li>
        )}
        <li>
          <NavIcon name="paperclip" size={13} />
          {formatRetention(plan.mediaRetentionDays)}
        </li>
        {PLAN_FEATURES.map((f) => (
          <li key={f} className={plan.features[f] ? "" : "is-off"}>
            <NavIcon name={plan.features[f] ? "check" : "minus"} size={13} />
            {FEATURE_LABELS[f]}
          </li>
        ))}
      </ul>
    </article>
  );
}
