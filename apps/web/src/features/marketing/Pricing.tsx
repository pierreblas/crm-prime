"use client";

import Link from "next/link";
import {
  AI_PACKS,
  AI_PACK_MONTHS,
  FEATURE_LABELS,
  formatAiIncluded,
  formatPlanLimit,
  formatRetention,
  PLAN_FEATURES,
  PLAN_KEYS,
  PLANS,
  retentionLabel,
  SELF_HOSTED_PLAN,
  TRIAL_AI_CONVERSATIONS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type PlanDef,
  type PlanLimit,
} from "@crm/shared";
import "./landing.css";
import { Arrow, Check, CONTACT, GITHUB, IconGit, MarketingFooter, MarketingHeader, Minus } from "./chrome";

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

const n = (v: number | null) => (v ?? 0).toLocaleString("es");
/** "100 en Gratis, 500 en Inicial, 2.000 en Pro y 6.000 en Empresa", del catálogo. */
const AI_BY_PLAN = (() => {
  const parts = PLAN_KEYS.map((k) => `${n(PLANS[k].aiConversations)} en ${PLANS[k].name}`);
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
})();
const PACKS_TEXT = AI_PACKS.map((p) => `${n(p.conversations)} por USD ${p.priceUsd}`).join(" o ");
const RETENTION_BY_PLAN = (() => {
  const parts = PLAN_KEYS.map((k) => `${retentionLabel(PLANS[k].mediaRetentionDays)} en ${PLANS[k].name}`);
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
})();

const FAQ = [
  {
    q: "¿Necesito tarjeta para empezar?",
    a: `No. Al crear tu cuenta tienes ${TRIAL_DAYS} días de Pro gratis, sin tarjeta, con ${n(TRIAL_AI_CONVERSATIONS)} conversaciones con IA para probar el agente. Al terminar sigues en el plan Gratis, que no caduca, y pasas a Inicial, Pro o Empresa cuando lo necesites.`,
  },
  {
    q: "¿Qué pasa cuando termina la prueba?",
    a: "No se corta ni se borra nada: tu cuenta pasa al plan Gratis con tus chats, contactos, embudos y agentes. Si durante la prueba conectaste más números o invitaste a más personas de las que admite Gratis, se quedan; lo que se frena es añadir más. La coexistencia vuelve desde Inicial; las difusiones y la API, con Pro. En el panel ves cada día cuánto te queda de prueba.",
  },
  {
    q: "¿Se cobra por usuario?",
    a: `No. El precio es por empresa, no por persona: Pro incluye hasta ${n(PLANS.pro.limits.users)} personas por USD ${PLANS.pro.priceUsd} al mes, y en Empresa no hay tope. Invitar a alguien más no te sube la factura.`,
  },
  {
    q: "¿Cómo se paga un plan?",
    a: "Nos escribes desde Ajustes › Plan (o al correo de contacto), te enviamos la factura y activamos el plan en el día. Se paga por adelantado cada mes o cada año, y puedes bajar o cancelar cuando quieras: aplica al siguiente periodo.",
  },
  {
    q: "¿Qué pasa cuando llego a un límite?",
    a: "Los límites cuentan al añadir: al conectar otro número, invitar a otra persona, o crear a mano un contacto o una oportunidad. Lo que ya tienes no se toca nunca, tampoco si bajas de plan. Y quien te escribe por WhatsApp entra siempre, aunque estés al tope de contactos u oportunidades: lo que se frena es crear o importar a mano. En Ajustes › Plan ves el uso y el plan que lo amplía.",
  },
  {
    q: "¿Hay límite de mensajes o de almacenamiento?",
    a: `No vendemos gigas ni cobramos por mensaje: escribe y recibe lo que haga falta, y que te escriban más no cambia la cifra. Si tu negocio crece mucho de forma sostenida, te propondremos el plan que te corresponde; nunca una sorpresa en la factura. Lo único que caduca son los adjuntos (fotos, audios, documentos): se guardan ${RETENTION_BY_PLAN}; el texto de la conversación se conserva siempre.`,
  },
  {
    q: "¿La inteligencia artificial está incluida en el precio?",
    a: `Sí. Cada plan trae un cupo de conversaciones atendidas por la IA de Driony al mes (${AI_BY_PLAN}), sin claves ni configuración. Cuenta cada conversación que el agente atiende en el mes, no cada mensaje ni cada respuesta. Si un mes se te queda corto, sumas conversaciones extra (${PACKS_TEXT}, una sola vez) que valen ${AI_PACK_MONTHS} meses. Al llegar al tope, el agente termina las que ya atendía y los chats nuevos pasan a tu equipo hasta el mes siguiente. Y si conectas tu propia clave de OpenAI, Anthropic o cualquier API compatible, no hay cupo, eliges el modelo de cada agente y pagas a tu proveedor a su precio, sin margen nuestro.`,
  },
  {
    q: "¿Y las conversaciones de WhatsApp?",
    a: "Las cobra Meta directamente a tu cuenta de WhatsApp Business, según su tarifa por país y tipo de mensaje, con un cupo mensual gratis por número. Driony no añade nada por mensaje ni te pide saldo: esa cuenta es entre tú y Meta.",
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
                Pruébalo {TRIAL_DAYS} días con todo Pro, sin tarjeta. Después sigues gratis o eliges tu plan:
                se paga por empresa, no por usuario. La IA ya viene incluida, y los mensajes de WhatsApp los cobra Meta a tu
                cuenta, sin recargo nuestro.
              </p>
            </div>

            <div className="lp-plans lp-plans--4">
              {PLAN_KEYS.map((k) => (
                <PlanCard key={k} plan={PLANS[k]} highlight={k === "pro"} />
              ))}
            </div>

            <AiWays />

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
            <p>Tu espacio en tu-empresa.driony.com en dos minutos. {TRIAL_DAYS} días de Pro gratis, sin tarjeta.</p>
            <div className="lp-cta__row">
              <Link href="/register" className="lp-btn lp-btn--white lp-btn--lg">
                Probar {TRIAL_DAYS} días gratis <Arrow />
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

/**
 * Las tres maneras de pagar la IA, una al lado de otra: incluida, con
 * conversaciones extra o con tu clave. Es lo que nos diferencia, así que va
 * justo debajo de los planes y antes de la lista de lo incluido.
 */
function AiWays() {
  const min = Math.min(...PLAN_KEYS.map((k) => PLANS[k].aiConversations ?? 0));
  const max = Math.max(...PLAN_KEYS.map((k) => PLANS[k].aiConversations ?? 0));
  return (
    <section className="lp-ai" aria-labelledby="lp-ai-title">
      <div className="lp-ai__head">
        <h2 id="lp-ai-title">La IA, como prefieras</h2>
        <p>
          Contamos conversaciones atendidas, no tokens ni créditos: una conversación es un cliente atendido en el mes,
          responda el agente una vez o veinte.
        </p>
      </div>
      <div className="lp-ai__ways">
        <div className="lp-ai__way">
          <span className="lp-ai__fig">
            {n(min)}–{n(max)}
          </span>
          <h3>Incluida en tu plan</h3>
          <p>Conversaciones al mes según el plan, sin claves ni configuración. El agente funciona desde el primer día.</p>
        </div>
        <div className="lp-ai__way">
          <span className="lp-ai__fig">+{n(AI_PACKS[0].conversations)}</span>
          <h3>Conversaciones extra</h3>
          <p>
            Para el mes que se queda corto: {PACKS_TEXT}, una sola vez. Valen {AI_PACK_MONTHS} meses y se gastan solo
            después de tu cupo.
          </p>
        </div>
        <div className="lp-ai__way">
          <span className="lp-ai__fig">Sin cupo</span>
          <h3>Con tu propia clave</h3>
          <p>
            Conecta OpenAI, Anthropic o cualquier API compatible, elige el modelo de cada agente y paga a tu proveedor a
            su precio. Sin margen nuestro.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Etiqueta corta de cada plan, encima del nombre. */
const TAG: Record<string, string> = { free: "Para probar", starter: "Para empezar", pro: "Más elegido", business: "Sin límites" };

function PlanCard({ plan, highlight }: { plan: PlanDef; highlight: boolean }) {
  const free = plan.priceUsd === 0;
  // El plan de la prueba se empieza igual que el gratis: creando la cuenta.
  const trial = plan.key === TRIAL_PLAN;
  // «Contactos activos al mes» ya no se enseña: es un umbral interno de uso
  // razonable (lo ve la consola), no algo que el cliente compra ni que se corta.
  const LIMITS: PlanLimit[] = ["numbers", "users", "contacts", "deals"];
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
          <div className="lp-row" key={k}>
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
        {free || trial ? (
          <Link href="/register" className={`lp-btn ${highlight ? "lp-btn--primary" : "lp-btn--ghost"}`}>
            {trial ? `Probar ${TRIAL_DAYS} días gratis` : "Empezar gratis"} <Arrow />
          </Link>
        ) : (
          <a href={`mailto:${CONTACT}?subject=Plan%20${encodeURIComponent(plan.name)}%20de%20Driony`} className={`lp-btn ${highlight ? "lp-btn--primary" : "lp-btn--ghost"}`}>
            Hablar con nosotros
          </a>
        )}
        <p className="lp-plan__note">
          {free
            ? `Sin tarjeta. No caduca. Empiezas con ${TRIAL_DAYS} días de ${PLANS[TRIAL_PLAN].name}.`
            : trial
              ? `${TRIAL_DAYS} días gratis al crear tu cuenta. Después se activa en el día desde Ajustes › Plan, sin permanencia.`
              : "Se activa en el día desde Ajustes › Plan. Sin permanencia."}
        </p>
      </div>
    </article>
  );
}
