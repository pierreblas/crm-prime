"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Wordmark } from "../../components/BrandMark";
import { formatAiIncluded, formatPlanLimit, formatTokens, PLAN_KEYS, PLANS, TRIAL_AI_TOKENS, TRIAL_DAYS, type BillingPeriodKey } from "@crm/shared";
import "./landing.css";
import { Arrow, Check, GITHUB, IconGit, MarketingFooter, MarketingHeader, MetaMark, Minus, NAV } from "./chrome";
import { HeroDemo } from "./HeroDemo";
import { PlanPicker } from "./PlanPicker";
import { PeriodPrice, PeriodToggle } from "./BillingPeriod";
import { AgentSimulator } from "./AgentSimulator";
import { FeatureDoc } from "./FeatureDoc";

// La página explica en este orden: qué es (la demo y ARM), lo que Driony hace
// (la bandeja y el LÉEME de FeatureDoc), cómo atendería en su rubro, cuánto
// tarda en arrancar, qué cambia, cuánto cuesta y qué pasa si no le convence.
// El estilo es el del panel.

// Antes y después, emparejados: cada problema al lado de lo que lo resuelve.
// Los globos de la portada: lo que llega de noche.
const ASKS = [
  ["11:52 p. m.", "Hola, ¿precio?"],
  ["11:56 p. m.", "¿Hay cupo?"],
  ["11:58 p. m.", "¿Hacen envíos?"],
] as const;

const COMPARE = [
  ["El lead escribe a las 9 de la noche y lo lees a las 9 de la mañana", "Respuesta en segundos, también de madrugada y en feriado"],
  ["Cinco vendedores con cinco celulares y nadie sabe quién atiende a quién", "Una sola bandeja, cada chat con dueño y el tiempo que lleva esperando"],
  ["«¿Precio?» cuarenta veces al día, a mano", "El agente cotiza desde tu catálogo, en la moneda del cliente"],
  ["Un vendedor nuevo tarda semanas en saber qué responder", "El copiloto le sugiere la respuesta y le resume al cliente en diez segundos"],
  ["Algo falla y te enteras cuando un cliente se queja", "Le preguntas al copiloto «¿hubo algún problema esta semana?» y te dice qué y dónde"],
  ["El comprobante llega en foto y se pierde entre los chats", "La IA lee la foto, registra el pago y avisa a tu equipo"],
  ["Leads que se enfrían sin que nadie se dé cuenta", "Cada conversación entra al embudo y un flujo la retoma si pasan días"],
  ["Anuncios que optimizan a clics y traen curiosos", "Meta aprende de tus ventas reales y trae gente que compra"],
  ["Pagar por usuario y dudar antes de sumar a alguien", "Precio por empresa: invitas a tu equipo sin que suba la factura"],
];

const STEPS = [
  {
    when: "Hoy, sin tarjeta",
    title: "Crea tu espacio y conecta tu número",
    text: `Tu panel en tu-empresa.driony.com en dos minutos. Enlazas tu WhatsApp Business desde el panel con la ventana oficial de Meta, sin tocar código ni cambiar de número.`,
  },
  {
    when: "En minutos",
    title: "Entrena a tu agente",
    text: "Le das tu catálogo, tu tono y tus reglas. Decides cuándo responde solo y cuándo pasa a una persona. Si no sabes por dónde empezar, el asistente redacta las instrucciones contigo.",
  },
  {
    when: "Desde el primer chat",
    title: "Él atiende, tú cierras",
    text: "El agente responde, califica y agenda; cada lead entra al embudo con su etapa y su dueño. Tu equipo entra cuando hay que cerrar, y lo ve todo en la bandeja. Si prefieres ir con cuidado, arranca en Copiloto: la IA sugiere cada respuesta y tu equipo la envía.",
  },
];

/** "2,5 M en Gratis, 12 M en Inicial, 50 M en Pro y 150 M en Empresa", del catálogo. */
function aiByPlan(): string {
  const parts = PLAN_KEYS.map((k) => `${formatTokens(PLANS[k].aiTokens ?? 0)} en ${PLANS[k].name}`);
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

/** Etiqueta corta de cada plan, encima del nombre. */
const PLAN_TAG: Record<string, string> = { free: "Para probar", starter: "Para empezar", pro: "Más elegido", business: "Sin límites" };

// Las tres claves del término, en el orden de las letras.
const ARM_KEYS = [
  {
    letter: "A",
    title: "Agentes",
    text: "Responden en segundos, cotizan desde tu catálogo, leen audios, fotos y comprobantes, agendan y pasan el chat a una persona cuando toca. Siempre desde tu propio número.",
  },
  {
    letter: "R",
    title: "Relación",
    text: "Recuerdan al cliente de una conversación a la siguiente, lo mueven de etapa en el embudo y lo retoman si pasan días sin respuesta. Ningún chat se queda sin dueño.",
  },
  {
    letter: "M",
    title: "Mando",
    text: "Tú decides cuándo el agente responde solo y cuándo solo sugiere y tu equipo aprueba, con qué IA trabaja (la incluida en tu plan o tu propia clave), cuánto puede gastar al mes y qué puede contar. Cada respuesta queda registrada, y un copiloto te explica por qué pasó cada cosa.",
  },
];

const FAQ = [
  {
    q: "¿Qué es ARM y en qué se diferencia de un CRM?",
    a: "ARM es Agentic Relationship Management. En un CRM tu equipo registra lo que pasó con cada cliente y el software espera a que alguien lo abra. En un ARM la relación la trabajan agentes de IA: atienden, cotizan, mueven el embudo y retoman al que se enfrió, y tu equipo supervisa, corrige y cierra. Driony está construido así desde el inicio: la bandeja, el embudo, los flujos y los agentes son un solo sistema, en tu propio número de WhatsApp.",
  },
  {
    q: "¿De verdad no necesito tarjeta?",
    a: `No. Al crear tu cuenta tienes ${TRIAL_DAYS} días del plan Pro completo, sin tarjeta: tres números, diez personas, difusiones, API y ${formatTokens(TRIAL_AI_TOKENS)} de tokens de IA para probar el agente en serio. Al terminar no se corta ni se borra nada: sigues en el plan Gratis (un número, dos personas y ${formatTokens(PLANS.free.aiTokens ?? 0)} de tokens de IA al mes) con tus chats, contactos y agentes, y pasas a Inicial, Pro o Empresa cuando quieras.`,
  },
  {
    q: "¿Necesito un número nuevo de WhatsApp?",
    a: `No. Conectas tu número de WhatsApp Business desde el panel, con la ventana oficial de Meta (Driony es Meta Business Partner). Si ya lo usas en la app del celular, desde el plan ${PLANS.starter.name} sigues usándolo a la vez (Coexistencia): lo que respondes en el celular y lo que responde Driony queda en el mismo chat.`,
  },
  {
    q: "¿Y si mi equipo no es técnico?",
    a: "No hace falta que lo sea. WhatsApp se conecta desde el panel con la ventana de Meta, el asistente redacta las instrucciones del agente contigo y los flujos se arman arrastrando bloques. Dentro del panel tienes un copiloto al que preguntarle cómo se configura algo o por qué no entró un lead: te da los pasos y el enlace a la pantalla. Si te atascas, nos escribes y te responde quien hace el producto.",
  },
  {
    q: "¿Cuánto cuesta la inteligencia artificial?",
    a: `Va incluida: cada plan trae tokens de IA al mes (${aiByPlan()}), sin configurar nada. Son los mismos tokens que pagamos al proveedor, sin créditos inventados, y de ahí sale todo lo que hace la IA. Si un mes se te queda corto, sumas tokens extra. Y si prefieres otro modelo o no tener cupo, conectas tu clave de OpenAI, Anthropic o cualquier API compatible y pagas a tu proveedor a su precio, sin recargo. Cada respuesta registra lo que costó y cada agente tiene su tope mensual.`,
  },
  {
    q: "¿Me cobran por conversación, por mensaje o por contacto?",
    a: "No. Pagas tu plan, por empresa, y la factura de Driony no cambia porque un mes te escriban el doble. Nada de créditos, saldo ni recargas. Lo único que va aparte es lo que cobra Meta por los mensajes de WhatsApp: lo paga tu cuenta de WhatsApp Business directamente, con su cupo gratis por número cada mes y sin que Driony añada nada. Si tu negocio crece mucho de forma sostenida, te proponemos un plan mayor; nunca una sorpresa en la factura.",
  },
  {
    q: "¿Puedo traer mis contactos de otra herramienta?",
    a: "Sí. Importas tus contactos desde un archivo CSV o Excel en Contactos. Tu número de WhatsApp es el mismo, así que tus clientes no notan el cambio, y con Coexistencia sigues respondiendo desde el celular mientras tu equipo se acostumbra al panel.",
  },
  {
    q: "¿Cómo sé que la IA no va a decir una tontería a un cliente?",
    a: "Responde solo con tu información: tu catálogo, tu base de conocimiento y los datos del contacto. Tú decides cuándo debe pasar el chat a una persona: cuando no esté segura, cuando el cliente lo pida o, por ejemplo, siempre que llegue un comprobante. Y puedes empezar en modo Copiloto: la IA sugiere la respuesta y tu equipo la aprueba antes de enviarla.",
  },
  {
    q: "¿La IA entiende audios, fotos y documentos?",
    a: "Sí. Transcribe los audios y describe las imágenes y documentos, y usa eso para responder. Si no puede ver una imagen, lo dice y pasa el chat a tu equipo en vez de inventar.",
  },
  {
    q: "¿Mis anuncios de Meta se enteran de las ventas?",
    a: "Sí. Activas las conversiones en Integraciones y eliges en cada etapa del embudo qué evento se envía a Meta (lead interesado, lead calificado, compra con el valor de la venta). Solo se envían para chats que llegaron por un anuncio de Click to WhatsApp, y cada evento una sola vez por oportunidad.",
  },
  {
    q: "¿Qué pasa con mis datos si un día me voy?",
    a: "Son tuyos. El código es abierto y la nube y la instalación propia comparten el mismo esquema de datos: puedes llevarte Driony a tu propio servidor y seguir con tus chats, contactos y agentes. Si te vas del todo, nos lo pides y te entregamos una copia de tu base.",
  },
];

export function Landing() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [period, setPeriod] = useState<BillingPeriodKey>("month");

  // Reveals y sección activa. El contenido es visible por defecto (sin JS);
  // la clase lp-js solo añade la animación al hidratar. Donde el navegador
  // sabe de líneas de tiempo de scroll (animation-timeline: view(), Chrome,
  // Safari y Firefox desde 2026), los reveals van en CSS y aquí no se observa
  // nada; el observador queda para los navegadores viejos.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add("lp-js");

    const cssTimelines = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
    const reveal = cssTimelines
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                e.target.classList.add("is-in");
                reveal?.unobserve(e.target);
              }
            }
          },
          { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
        );
    if (reveal) root.querySelectorAll(".lp-reveal").forEach((el) => reveal.observe(el));

    const sections = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
    );
    NAV.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) sections.observe(el);
    });

    return () => {
      reveal?.disconnect();
      sections.disconnect();
    };
  }, []);

  return (
    <div className="lp" id="lp-root" ref={rootRef} lang="es">
      <a href="#contenido" className="lp-skip">
        Saltar al contenido
      </a>
      <MarketingHeader active={active} home />

      <main id="contenido">
        {/* ── Portada: los clientes preguntan, Driony contesta con el titular y debajo, la demo ── */}
        <section className="lp-hero">
          <div className="lp-hero__top lp-petrol">
            <div className="lp-wrap lp-hero__grid">
              <div className="lp-hero__side">
                {/* El rótulo tacha CRM y sella ARM: la categoría en un vistazo. */}
                <p className="lp-hero__kicker lp-anim" style={{ animationDelay: "0.02s" }}>
                  <span className="lp-arm" role="img" aria-label="De CRM a ARM">
                    <s>CRM</s>
                    <b>ARM</b>
                  </span>
                  <span>Agentic Relationship Management</span>
                </p>
                <ul className="lp-asks" aria-label="Lo que escriben tus clientes de noche">
                  {ASKS.map(([when, text], i) => (
                    <li className="lp-bub lp-ask lp-anim" style={{ animationDelay: `${0.1 + i * 0.12}s` }} key={text}>
                      <time>{when}</time>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
              {/* El dolor en una escena (el lead que escribe de noche) y quién contesta: una idea por línea. */}
              <div className="lp-bub lp-say lp-lime lp-anim" style={{ animationDelay: "0.3s" }}>
                <h1>
                  <span className="lp-hero__line">Tus clientes escriben a medianoche.</span>{" "}
                  <span className="lp-hero__line">Tu agente responde.</span>
                </h1>
                <p className="lp-hero__sub">
                  Agentes de IA en tu propio número de WhatsApp que cotizan con tu catálogo, agendan y retoman al que se enfrió. Tu
                  equipo lo ve todo y decide cuándo entrar.
                </p>
                <div className="lp-hero__cta">
                  <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
                    Probar {TRIAL_DAYS} días gratis <Arrow />
                  </Link>
                  <a href="#como" className="lp-btn lp-btn--ghost lp-btn--lg">
                    Cómo funciona
                  </a>
                </div>
                <ul className="lp-hero__proofs" aria-label="Lo que incluye la prueba">
                  <li>
                    <Check /> Sin tarjeta
                  </li>
                  <li>
                    <Check /> Sin cobro por conversación
                  </li>
                  <li>
                    <Check /> Listo en 2 minutos
                  </li>
                  <li>
                    <Check /> IA incluida o tu propia clave
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="lp-hero__stage lp-band">
            <div className="lp-wrap">
              <div className="lp-hero__console lp-anim" style={{ animationDelay: "0.4s" }}>
                <HeroDemo />
              </div>
              <div className="lp-hero__under">
                <div className="lp-partner" title="Driony forma parte del programa de partners de Meta">
                  <MetaMark />
                  <span>
                    <b>Meta Business Partner</b>
                    <span className="lp-partner__sub">API oficial de WhatsApp Business</span>
                  </span>
                </div>
                <p>Demo con datos de ejemplo. En tu cuenta responde la IA con tu catálogo, tu agenda y tus reglas.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Qué es ARM: el término en el que se basa todo, con sus tres claves ── */}
        <section className="lp-section lp-arm-sec" id="arm">
          <div className="lp-wrap">
            <div className="lp-arm-def lp-reveal">
              <div className="lp-arm-def__word" aria-hidden="true">
                <span>ARM</span>
                <span className="lp-arm-def__sub">Agentic Relationship Management</span>
              </div>
              <div className="lp-head">
                <h2>Un CRM guarda lo que pasó con el cliente. Un ARM pone agentes a atenderlo.</h2>
                <p className="lp-lede">
                  Agentic Relationship Management: la relación con cada cliente la trabajan agentes de IA desde tu propio WhatsApp, y tu equipo la supervisa. Driony está construido así: bandeja, embudo, flujos y agentes son un solo sistema.
                </p>
              </div>
            </div>
            <dl className="lp-arm-keys lp-reveal">
              {ARM_KEYS.map((k, i) => (
                <div className={`lp-bub lp-arm-key lp-arm-key--${i}`} key={k.letter}>
                  <dt>
                    {/* La letra, enorme y cortada por la esquina del bloque. */}
                    <span className="lp-arm-key__big" aria-hidden="true">
                      <span>{k.letter}</span>
                    </span>
                    {k.title}
                  </dt>
                  <dd>{k.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Capacidades ── */}
        <section className="lp-section lp-band" id="capacidades">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Todo lo que hace Driony mientras tú cierras.</h2>
              <p className="lp-lede">
                Deja de saltar entre el celular, hojas de cálculo y notas sueltas. Conversaciones, embudo y agentes en una sola pantalla, con cada lead a la vista.
              </p>
            </div>

            <figure className="lp-stage lp-reveal">
              <div className="lp-shot">
                {/* Una por tema: la que no toca no se pinta y, al ser «lazy», no se descarga. */}
                {(["dark", "light"] as const).map((theme) => (
                  <img
                    key={theme}
                    className={`lp-shot__img lp-shot__img--${theme}`}
                    src={theme === "dark" ? "/landing/bandeja.webp" : "/landing/bandeja-claro.webp"}
                    alt="La bandeja de Driony: conversaciones de WhatsApp de varios números, con filtros de pendientes y el agente de IA en modo Copilot"
                    width={2160}
                    height={1350}
                    loading="lazy"
                    decoding="async"
                  />
                ))}
              </div>
              <figcaption className="lp-stage__notes">
                <p>
                  <b>Todos tus números, una bandeja.</b> En vivo, con dueño claro y el tiempo que lleva esperando cada cliente.
                </p>
                <p>
                  <b>La IA a tu ritmo.</b> Responde sola, te sugiere la respuesta o se aparta: lo eliges por conversación.
                </p>
                <p>
                  <b>Nada se queda sin dueño.</b> Filtros de pendientes, sin asignar y míos, y avisos cuando alguien espera.
                </p>
              </figcaption>
            </figure>

            {/* Lo que hace, contado como un LÉEME: índice numerado y una muestra concreta por punto. */}
            <FeatureDoc />
          </div>
        </section>

        {/* ── Arma tu agente: rubro, misión y tono, y el chat que saldría; el botón lleva al alta con eso ── */}
        <section className="lp-section" id="rubros">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Arma tu agente en 30 segundos y mira cómo atiende.</h2>
              <p className="lp-lede">
                Elige tu rubro, su misión y su tono. Lo que ves es un ejemplo escrito a mano; en tu cuenta lo hace la IA con tus precios, tus horarios y tus reglas, y arranca con esta misma configuración.
              </p>
            </div>
            <div className="lp-reveal">
              <AgentSimulator />
            </div>
          </div>
        </section>

        {/* ── Cómo funciona: tres pasos, con lo que tardan ── */}
        <section className="lp-section lp-band" id="como">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Empiezas hoy, no en tres semanas.</h2>
              <p className="lp-lede">Sin migraciones ni implementaciones eternas. Creas tu espacio, conectas tu número y el agente atiende el primer chat el mismo día.</p>
            </div>
            <ol className="lp-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {STEPS.map((s, i) => (
                <li className="lp-step lp-reveal" key={s.title}>
                  <div className="lp-step__n" aria-hidden="true">
                    {i + 1}
                  </div>
                  <span className="lp-step__when">{s.when}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="lp-inline-cta lp-reveal">
              <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
                Crear mi espacio gratis <Arrow />
              </Link>
              <span>{TRIAL_DAYS} días de Pro, sin tarjeta. Si no te convence, no pagas nada.</span>
            </div>
          </div>
        </section>

        {/* ── Por qué Driony ── */}
        <section className="lp-section lp-petrol" id="porque">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Lo que cambia desde la primera semana.</h2>
            </div>
            <div className="lp-vs lp-reveal" role="table" aria-label="WhatsApp a mano frente a Driony">
              <div className="lp-vs__row lp-vs__row--head" role="row">
                <span role="columnheader">WhatsApp a mano</span>
                <span role="columnheader">ARM con Driony</span>
              </div>
              {COMPARE.map(([bad, good]) => (
                <div className="lp-vs__row" role="row" key={bad}>
                  <span className="lp-bub lp-vs__bad" role="cell">
                    <Minus />
                    {bad}
                  </span>
                  <span className="lp-bub lp-bub--out lp-vs__good" role="cell">
                    <Check />
                    {good}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Planes: el precio a la vista, del catálogo compartido ── */}
        <section className="lp-section" id="planes">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Precio por empresa. Nunca por conversación.</h2>
              <p className="lp-lede">
                Todos empiezan igual: {TRIAL_DAYS} días de Pro gratis, sin tarjeta. Después sigues en Gratis o eliges el plan que te toca. Invitar a alguien de tu equipo no sube la factura, y que te escriban más tampoco.
              </p>
            </div>
            <div className="lp-pay lp-reveal" role="list" aria-label="Qué pagas y qué no">
              <div className="lp-pay__cell lp-pay__cell--yes" role="listitem">
                <h3>Pagas</h3>
                <p>
                  <span className="lp-pay__big">Tu plan, por empresa</span>
                  Una cifra al mes. Las personas, los contactos y los chats que entren no la mueven.
                </p>
              </div>
              <div className="lp-pay__cell" role="listitem">
                <h3>No pagas</h3>
                <p>
                  <span className="lp-pay__big">Por conversación. Por mensaje. Por contacto. Por usuario.</span>
                  Sin créditos, sin saldo que recargar, sin «agente adicional».
                </p>
              </div>
              <div className="lp-pay__cell" role="listitem">
                <h3>Aparte, y no pasa por Driony</h3>
                <p>
                  <span className="lp-pay__big">Lo de Meta</span>
                  Los mensajes de WhatsApp los cobra Meta a tu cuenta, con un cupo gratis al mes por número. Sin billetera intermedia ni recargo. La IA va en el plan; con tu clave, sin límite de tokens.
                </p>
              </div>
            </div>
            <div className="lp-reveal">
              <PeriodToggle value={period} onChange={setPeriod} />
            </div>
            <div className="lp-plans lp-plans--snap lp-reveal">
              {PLAN_KEYS.map((k) => {
                const plan = PLANS[k];
                const pro = k === "pro";
                return (
                  <article className={`lp-plan lp-plan--snap${pro ? " lp-plan--cloud lp-petrol" : ""}`} key={k} data-plan={k}>
                    <div className="lp-plan__tag">{PLAN_TAG[k] ?? plan.name}</div>
                    <h3>{plan.name}</h3>
                    <PeriodPrice plan={plan} period={period} />
                    <p>{plan.tagline}</p>
                    <div className="lp-plan__rows">
                      {(["numbers", "users"] as const).map((lim) => (
                        <div className="lp-row" key={lim}>
                          <span className="lp-row__ic">
                            <Check />
                          </span>
                          {formatPlanLimit(lim, plan.limits[lim])}
                        </div>
                      ))}
                      <div className="lp-row">
                        <span className="lp-row__ic">
                          <Check />
                        </span>
                        {formatAiIncluded(plan.aiTokens)}
                      </div>
                    </div>
                    {pro && (
                      <div className="lp-plan__cta">
                        <Link href="/register" className="lp-btn lp-btn--primary">
                          Probar {TRIAL_DAYS} días gratis <Arrow />
                        </Link>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="lp-reveal">
              <PlanPicker />
            </div>
            <p className="lp-plans__note lp-reveal">
              Sin permanencia: bajas o cancelas cuando quieras, y tus datos siguen siendo tuyos.{" "}
              <Link href="/precios" className="lp-plans__link">
                Ver precios y límites de cada plan <Arrow />
              </Link>
            </p>

            <div className="lp-oss lp-reveal">
              <div>
                <h3>¿Prefieres tu propio servidor?</h3>
                <p>
                  Driony es código abierto (AGPL-3.0). Lo instalas con Docker, sin planes ni límites, con tus datos en tu base y tus propias claves. Es el mismo esquema de datos que la nube: se migra, no se rehace.
                </p>
              </div>
              <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--ghost">
                <IconGit /> Ver en GitHub
              </a>
            </div>

            <div className="lp-faq lp-reveal" id="preguntas">
              <h3>Lo que preguntan antes de empezar</h3>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Cierre: el globo gigante, cortado por el borde ── */}
        <section className="lp-end lp-petrol">
          <div className="lp-bub lp-bub--out lp-end__giant lp-lime">
            <h2>Tu próximo lead escribe esta noche. ¿Quién le responde?</h2>
            <p>Pon un agente en tu número, dale tu catálogo y tus reglas, y deja de perder ventas en WhatsApp. Hoy, en dos minutos.</p>
            <div className="lp-cta__row">
              <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
                Probar {TRIAL_DAYS} días gratis <Arrow />
              </Link>
              <Link href="/login" className="lp-btn lp-btn--ghost lp-btn--lg">
                Iniciar sesión
              </Link>
            </div>
            <ul className="lp-end__proof" aria-label="Sin riesgo">
              <li>
                <Check /> Sin tarjeta
              </li>
              <li>
                <Check /> Sin permanencia
              </li>
              <li>
                <Check /> Sigues en Gratis al terminar
              </li>
              <li>
                <Check /> Tus datos son tuyos
              </li>
            </ul>
          </div>
          <div className="lp-end__sign" aria-hidden="true">
            <Wordmark size={46} />
          </div>
        </section>
      </main>

      <MarketingFooter home />
    </div>
  );
}
