"use client";

import { FEATURE_LABELS, PLAN_FEATURES, formatPlanPrice, type PlanDef, formatRetention } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useMyPlan } from "./usePlan";

/**
 * Ajustes › Plan: qué plan tiene la empresa, cuánto lleva usado y qué
 * incluye cada uno. No hay cobro automático: cambiar de plan es escribir al
 * operador, que lo hace desde la consola de plataforma.
 */
export function PlanSettings() {
  const { data, isPending, isError, refetch } = useMyPlan();

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

  const { plan, usage, plans } = data;
  const subject = encodeURIComponent(`Cambio de plan (ahora: ${plan.name})`);

  return (
    <div className="plan">
      <header className="plan-head">
        <h3>Tu plan</h3>
        <p>
          Los límites se aplican al añadir números o usuarios; lo que ya tienes no se
          toca. Para cambiar de plan, escríbenos y lo activamos el mismo día.
        </p>
      </header>

      <section className="plan-current">
        <div className="plan-current__head">
          <div>
            <span className="plan-current__name">{plan.name}</span>
            <span className="plan-current__price">{formatPlanPrice(plan)}</span>
            <p className="plan-current__tagline">{plan.tagline}</p>
          </div>
          {data.contactEmail && (
            <a className="btn btn-primary" href={`mailto:${data.contactEmail}?subject=${subject}`}>
              Cambiar de plan
            </a>
          )}
        </div>

        <div className="plan-usage">
          <Usage label="Números de WhatsApp" used={usage.numbers} limit={plan.limits.numbers} />
          <Usage label="Usuarios del equipo" used={usage.users} limit={plan.limits.users} />
          <Usage label="Contactos" used={usage.contacts} limit={plan.limits.contacts} />
          <Usage label="Oportunidades abiertas" used={usage.deals} limit={plan.limits.deals} />
          <Usage label="Contactos activos este mes" used={usage.activeContacts} limit={plan.limits.activeContacts} />
        </div>
        <p className="plan-fairuse">
          Contactos, oportunidades y contactos activos son de <strong>uso razonable</strong>: quien te escribe por
          WhatsApp entra siempre; al tope se frena crear o importar a mano. Si superas los activos del mes de forma
          sostenida, te propondremos el plan que te corresponde. {formatRetention(plan.mediaRetentionDays)}.
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

      <section>
        <h4 className="plan-all__title">Todos los planes</h4>
        <div className="plan-grid">
          {plans.map((p) => (
            <PlanCard key={p.key} plan={p} current={p.key === plan.key} />
          ))}
        </div>
      </section>
    </div>
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

function PlanCard({ plan, current }: { plan: PlanDef; current: boolean }) {
  const lim = (n: number | null, one: string, many: string) =>
    n === null ? `${many} sin límite` : `${n} ${n === 1 ? one : many}`;
  return (
    <article className={`plan-card${current ? " is-current" : ""}`}>
      <div className="plan-card__head">
        <span className="plan-card__name">{plan.name}</span>
        {current && <span className="plan-card__badge">Tu plan</span>}
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
