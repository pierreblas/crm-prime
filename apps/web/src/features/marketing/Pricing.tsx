"use client";

import Link from "next/link";
import { FEATURE_LABELS, formatAiIncluded, formatPlanLimit, formatRetention, PLAN_FEATURES, PLAN_KEYS, PLANS, SELF_HOSTED_PLAN, type PlanDef, type PlanLimit } from "@crm/shared";
import "./landing.css";
import { Arrow, Check, CONTACT, GITHUB, IconGit, LpThemeScript, MarketingFooter, MarketingHeader, Minus } from "./chrome";

/** Lo que llevan todos los planes de la nube, también el gratis. */
const INCLUDED = [
  "Bandeja en tiempo real, multi-número",
  "Agente de IA incluido, o con tu propia clave sin cupo",
  "Embudos con automatizaciones por etapa",
  "Flujos y respuestas por palabra clave",
  "Catálogo con precios en varias monedas",
  "Conversiones de anuncios a Meta",
  "Campos personalizados y etiquetas",
  "Base de conocimiento del agente",
  "Llamadas registradas en el chat",
  "Soporte por correo",
];

const FAQ = [
  {
    q: "¿Necesito tarjeta para empezar?",
    a: "No. El plan Gratis no pide tarjeta ni caduca. Pasas a Pro o Empresa cuando lo necesites.",
  },
  {
    q: "¿Cómo se paga Pro o Empresa?",
    a: "Nos escribes desde Ajustes › Plan (o al correo de contacto), te enviamos la factura y activamos el plan en el día. Se paga por adelantado cada mes o cada año, y puedes bajar o cancelar cuando quieras: aplica al siguiente periodo.",
  },
  {
    q: "¿Qué pasa cuando llego a un límite?",
    a: "Los límites cuentan al añadir: al conectar otro número, invitar a otra persona, o crear a mano un contacto o una oportunidad. Lo que ya tienes no se toca nunca, tampoco si bajas de plan. Y quien te escribe por WhatsApp entra siempre, aunque estés al tope de contactos u oportunidades: lo que se frena es crear o importar a mano. En Ajustes › Plan ves el uso y el plan que lo amplía.",
  },
  {
    q: "¿Hay límite de mensajes o de almacenamiento?",
    a: "No vendemos gigas ni cobramos por mensaje. Cada plan está pensado para un número de contactos activos al mes (quien envía o recibe un mensaje ese mes, difusiones aparte); es orientativo, los picos son normales y nada se corta. Si lo superas de forma sostenida, te propondremos el plan que te corresponde. Lo único que caduca son los adjuntos (fotos, audios, documentos): se guardan 90 días en Gratis, 1 año en Pro y 3 años en Empresa; el texto de la conversación se conserva siempre.",
  },
  {
    q: "¿La inteligencia artificial está incluida en el precio?",
    a: "Sí. Cada plan trae un cupo de conversaciones atendidas por la IA de Driony al mes (100 en Gratis, 2.000 en Pro y 10.000 en Empresa), sin claves ni configuración. Cuenta cada conversación que el agente atiende en el mes, no cada mensaje. Al llegar al cupo, el agente termina las que ya atendía y los chats nuevos pasan a tu equipo hasta el mes siguiente. Si conectas tu propia clave de OpenAI, Anthropic o cualquier API compatible, no hay cupo, eliges el modelo de cada agente y pagas a tu proveedor a su precio, sin margen nuestro.",
  },
  {
    q: "¿Y las conversaciones de WhatsApp?",
    a: "Las cobra Meta directamente a tu cuenta de WhatsApp Business, según su tarifa por país y tipo de conversación. Driony no añade nada por mensaje.",
  },
  {
    q: "¿Puedo instalarlo en mi servidor en lugar de usar la nube?",
    a: "Sí. Driony es código abierto (AGPL-3.0) y se instala con Docker Compose, sin planes ni límites. Tus datos se quedan en tu base y usas tu propia app de Meta. Si luego quieres la nube, o al revés, se migra: es el mismo esquema de datos.",
  },
];

/** Página de precios: los planes salen del catálogo compartido, así que cambian aquí cuando cambian en el código. */
export function Pricing() {
  return (
    <div className="lp" id="lp-root" lang="es" suppressHydrationWarning>
      <LpThemeScript />
      <a href="#contenido" className="lp-skip">
        Saltar al contenido
      </a>
      <MarketingHeader active="precios" />

      <main id="contenido">
        <section className="lp-section lp-section--first">
          <div className="lp-wrap">
            <div className="lp-head">
              <h1>Precios claros, sin sorpresas.</h1>
              <p className="lp-lede">
                Empieza gratis y sin tarjeta. Pasas a Pro o Empresa cuando crezcan el equipo o los
                números. La IA y WhatsApp los pagas a su proveedor con tus propias cuentas, sin margen
                nuestro.
              </p>
            </div>

            <div className="lp-plans lp-plans--3">
              {PLAN_KEYS.map((k) => (
                <PlanCard key={k} plan={PLANS[k]} highlight={k === "pro"} />
              ))}
            </div>

            <div className="lp-included">
              <h2>Incluido en todos los planes</h2>
              <ul className="lp-included__list">
                {INCLUDED.map((t) => (
                  <li key={t}>
                    <Check /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-section" id="servidor">
          <div className="lp-wrap">
            <article className="lp-plan lp-plan--self">
              <div className="lp-plan__self-grid">
                <div>
                  <div className="lp-plan__tag">Código abierto · AGPL-3.0</div>
                  <h3>{SELF_HOSTED_PLAN.name}</h3>
                  <p className="lp-price">
                    Gratis <small>para siempre</small>
                  </p>
                  <p>
                    El CRM completo para una empresa, con tus datos en tu base y tus propias claves. Lo
                    levantas con Docker en tu servidor y no dependes de nadie. {SELF_HOSTED_PLAN.tagline}
                  </p>
                  <div className="lp-plan__cta">
                    <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--ghost">
                      <IconGit /> Ver en GitHub
                    </a>
                    <Link href="/docs/autoalojado" className="lp-btn lp-btn--ghost">
                      Guía de instalación
                    </Link>
                  </div>
                </div>
                <div className="lp-plan__rows">
                  {[
                    "Una empresa; usuarios, números, contactos y oportunidades sin límite",
                    "Adjuntos sin plazo: el disco es tuyo",
                    "Se instala con Docker Compose en tu servidor",
                    "Tu app de Meta y tus claves de IA",
                    "Coexistencia, difusiones, API y webhooks incluidos",
                    "Actualizas tú, cuando quieras, desde GitHub",
                  ].map((t) => (
                    <div className="lp-row" key={t}>
                      <span className="lp-row__ic">
                        <Check />
                      </span>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-faq">
              <h3>Preguntas sobre precios</h3>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta-band">
          <div className="lp-wrap lp-cta-band__inner">
            <h2>Empieza hoy, paga cuando crezcas.</h2>
            <p>Tu espacio en tu-empresa.driony.com en dos minutos. Sin tarjeta.</p>
            <div className="lp-cta__row">
              <Link href="/register" className="lp-btn lp-btn--white lp-btn--lg">
                Empezar gratis <Arrow />
              </Link>
              <a href={`mailto:${CONTACT}?subject=Planes%20de%20Driony`} className="lp-btn lp-btn--outline lp-btn--lg">
                Hablar con nosotros
              </a>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

/** Etiqueta corta de cada plan, encima del nombre. */
const TAG: Record<string, string> = { free: "Para probar", pro: "Más elegido", business: "Sin límites" };

function PlanCard({ plan, highlight }: { plan: PlanDef; highlight: boolean }) {
  const free = plan.priceUsd === 0;
  const LIMITS: PlanLimit[] = ["numbers", "users", "contacts", "deals", "activeContacts"];
  return (
    <article className={`lp-plan${highlight ? " lp-plan--cloud" : ""}`} data-plan={plan.key}>
      <div className="lp-plan__tag">{TAG[plan.key] ?? plan.name}</div>
      <h3>{plan.name}</h3>
      <p className="lp-price">
        USD {plan.priceUsd}
        <small>/mes</small>
      </p>
      <p>{plan.tagline}</p>
      <div className="lp-plan__rows">
        {LIMITS.map((k) => (
          <div className="lp-row" key={k} title={k === "activeContacts" ? "Orientativo: no corta nada. Quien envía o recibe un mensaje en el mes, difusiones aparte." : undefined}>
            <span className="lp-row__ic">
              <Check />
            </span>
            {formatPlanLimit(k, plan.limits[k])}
          </div>
        ))}
        {plan.aiConversations !== null && (
          <div className="lp-row" title="Con tu propia clave de IA no hay cupo.">
            <span className="lp-row__ic">
              <Check />
            </span>
            {formatAiIncluded(plan.aiConversations)}
          </div>
        )}
        <div className="lp-row">
          <span className="lp-row__ic">
            <Check />
          </span>
          {formatRetention(plan.mediaRetentionDays)}
        </div>
        {PLAN_FEATURES.map((f) => (
          <div className={`lp-row${plan.features[f] ? "" : " lp-row--off"}`} key={f}>
            <span className="lp-row__ic">{plan.features[f] ? <Check /> : <Minus />}</span>
            {FEATURE_LABELS[f]}
          </div>
        ))}
      </div>
      <div className="lp-plan__cta">
        {free ? (
          <Link href="/register" className="lp-btn lp-btn--primary">
            Empezar gratis <Arrow />
          </Link>
        ) : (
          <a href={`mailto:${CONTACT}?subject=Plan%20${encodeURIComponent(plan.name)}%20de%20Driony`} className={`lp-btn ${highlight ? "lp-btn--primary" : "lp-btn--ghost"}`}>
            Hablar con nosotros
          </a>
        )}
        <p className="lp-plan__note">{free ? "Sin tarjeta. No caduca." : "Se activa en el día desde Ajustes › Plan. Sin permanencia."}</p>
      </div>
    </article>
  );
}
