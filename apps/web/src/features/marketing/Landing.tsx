"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatAiIncluded, formatPlanLimit, formatTokens, PLAN_KEYS, PLANS, TRIAL_AI_TOKENS, TRIAL_DAYS } from "@crm/shared";
import "./landing.css";
import { Arrow, Check, GITHUB, IconGit, MarketingFooter, MarketingHeader, MetaMark, Minus, NAV, Pause, Play } from "./chrome";
import { HeroTerminal } from "./HeroTerminal";
import { LeadCalc } from "./LeadCalc";
import { PlanPicker } from "./PlanPicker";
import { AgentSimulator } from "./AgentSimulator";

// La página argumenta en este orden: el dolor con cifras del visitante, lo que
// Driony hace, si sirve para su rubro, cuánto tarda, qué cambia, cuánto cuesta
// y qué pasa si no le convence. Cada sección cierra una objeción.

// Antes y después, emparejados: cada problema al lado de lo que lo resuelve.
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

// Frases de la banda de color. Se pintan dos veces para que la marquesina
// haga un bucle sin salto.
const BAND_ITEMS = [
  `${TRIAL_DAYS} días de Pro gratis`,
  "Agentic Relationship Management",
  "Sin tarjeta",
  "Responde en segundos",
  "Desde tu propio número",
  "Meta Business Partner",
  "IA incluida en el plan",
  "La IA sugiere, tú apruebas",
  "Precio por empresa, no por usuario",
  "Sin cobro por conversación ni por mensaje",
  "Lee fotos y comprobantes",
  "Código abierto",
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
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<string | null>(null);

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
        {/* ── Hero: dos bloques, el lima con el argumento y el oscuro con el producto real ── */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              {/* El rótulo tacha CRM y sella ARM: la categoría en un vistazo. */}
              <p className="lp-hero__kicker lp-anim" style={{ animationDelay: "0.02s" }}>
                <span className="lp-arm" role="img" aria-label="De CRM a ARM">
                  <s>CRM</s>
                  <b>ARM</b>
                </span>
                <span>Agentic Relationship Management</span>
              </p>
              <h1 className="lp-anim" style={{ animationDelay: "0.08s" }}>
                Agentes de IA que <span className="lp-hero__accent">venden</span> por tu WhatsApp. Tú mandas.
              </h1>
              <p className="lp-hero__sub lp-anim" style={{ animationDelay: "0.16s" }}>
                En tu propio número: responden en segundos, cotizan, leen comprobantes y retoman al que se enfrió, también a las 11 de la noche. Tu equipo supervisa y cierra.
              </p>
              <div className="lp-hero__cta lp-anim" style={{ animationDelay: "0.24s" }}>
                <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
                  Probar {TRIAL_DAYS} días gratis <Arrow />
                </Link>
                <a href="#costo" className="lp-btn lp-btn--ghost lp-btn--lg">
                  Cuánto pierdes respondiendo tarde
                </a>
              </div>
              <ul className="lp-hero__proofs lp-anim" style={{ animationDelay: "0.32s" }} aria-label="Lo que incluye la prueba">
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
              <div className="lp-partner lp-anim" style={{ animationDelay: "0.4s" }} title="Driony forma parte del programa de partners de Meta">
                <MetaMark />
                <span>
                  <b>Meta Business Partner</b>
                  <span className="lp-partner__sub">API oficial de WhatsApp Business</span>
                </span>
              </div>
            </div>

            <div className="lp-hero__demo lp-anim" style={{ animationDelay: "0.2s" }}>
              <span className="lp-hero__spine" aria-hidden="true">
                Agentic Relationship Management // Driony // En vivo
              </span>
              <figure className="lp-hero__shot">
                <div className="lp-hero__shot-bar" aria-hidden="true">
                  <span>[ + ] Driony // Bandeja // Copilot</span>
                  <i />
                </div>
                <div className="lp-hero__shot-frame">
                  <img
                    src="/landing/bandeja.webp"
                    alt="La bandeja de Driony: un agente de IA en modo Copilot responde a un cliente por WhatsApp y le agenda una demo, con el equipo viéndolo todo"
                    width={2160}
                    height={1350}
                    fetchPriority="high"
                    decoding="async"
                  />
                </div>
              </figure>
              {/* Debajo de la captura, el registro del agente escribiéndose: lo que hace, en sus palabras. */}
              <HeroTerminal />
            </div>
          </div>
        </section>

        {/* ── Banda de color a todo ancho, en marquesina ── */}
        <section className="lp-band" data-paused={paused} aria-label="Lo que incluye Driony">
          <div className="lp-band__track">
            {[0, 1].map((copy) => (
              <div className="lp-band__group" key={copy} aria-hidden={copy === 1}>
                {BAND_ITEMS.map((t) => (
                  <span className="lp-band__item" key={t}>
                    {t}
                    <i className="lp-band__dot" />
                  </span>
                ))}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="lp-band__pause"
            aria-pressed={paused}
            aria-label={paused ? "Reanudar el movimiento de la banda" : "Pausar el movimiento de la banda"}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? <Play /> : <Pause />}
          </button>
        </section>

        {/* ── Qué es ARM: el término en el que se basa todo, con sus tres claves ── */}
        <section className="lp-section lp-arm-sec" id="arm">
          <div className="lp-wrap">
            <div className="lp-arm-def lp-reveal">
              <div className="lp-arm-def__word" aria-hidden="true">
                <span>ARM</span>
                <span className="lp-arm-def__sub">Agentic // Relationship // Management</span>
              </div>
              <div className="lp-head">
                <p className="lp-tag">[ 00 // Qué es ARM ]</p>
                <h2>Un CRM guarda lo que pasó con el cliente. Un ARM pone agentes a atenderlo.</h2>
                <p className="lp-lede">
                  Agentic Relationship Management: la relación con cada cliente la trabajan agentes de IA desde tu propio WhatsApp, y tu equipo la supervisa. Driony está construido así: bandeja, embudo, flujos y agentes son un solo sistema.
                </p>
              </div>
            </div>
            <dl className="lp-arm-keys lp-reveal">
              {ARM_KEYS.map((k) => (
                <div className="lp-arm-key" key={k.letter}>
                  <dt>
                    <b aria-hidden="true">{k.letter}</b>
                    {k.title}
                  </dt>
                  <dd>{k.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── El costo de responder tarde: la cuenta con las cifras del visitante ── */}
        <section className="lp-section" id="costo">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <p className="lp-tag">[ 01 // Lo que pierdes ]</p>
              <h2>El lead que esperó hasta mañana ya le compró a otro.</h2>
              <p className="lp-lede">
                Tus clientes escriben a las 9 de la noche, el domingo, en plena hora punta de tu equipo. Si la respuesta llega al día siguiente, ya decidieron. Haz la cuenta con tus números.
              </p>
            </div>
            <div className="lp-reveal">
              <LeadCalc />
            </div>
          </div>
        </section>

        {/* ── Capacidades ── */}
        <section className="lp-section" id="capacidades">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <p className="lp-tag">[ 02 // Capacidades ]</p>
              <h2>Todo lo que hace Driony mientras tú cierras.</h2>
              <p className="lp-lede">
                Deja de saltar entre el celular, hojas de cálculo y notas sueltas. Conversaciones, embudo y agentes en una sola pantalla, con cada lead a la vista.
              </p>
            </div>

            <figure className="lp-stage lp-reveal">
              <div className="lp-shot">
                <img
                  src="/landing/bandeja.webp"
                  alt="La bandeja de Driony: conversaciones de WhatsApp de varios números, con filtros de pendientes y el agente de IA en modo Copilot"
                  width={2160}
                  height={1350}
                  loading="lazy"
                  decoding="async"
                />
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

            <div className="lp-bento">
              <article className="lp-card lp-card--full lp-card--feature lp-reveal">
                <div className="lp-card__media">
                  <img
                    src="/landing/agentes.webp"
                    alt="El editor de un agente de IA: nombre, número que atiende, modelo elegido y sus instrucciones, con el asistente que ayuda a redactarlas"
                    width={1164}
                    height={728}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Un vendedor de IA que conoce tu negocio como tú</h3>
                <p>
                  Responde con <b>tu</b> catálogo, <b>tu</b> base de conocimiento y los datos de cada contacto. Recuerda al cliente de una conversación a la siguiente, mueve la oportunidad de etapa y, cuando el caso lo pide, pasa el chat a tu equipo y lo deja claro en la bandeja. Nunca inventa un precio.
                </p>
                <div className="lp-mini">
                  <span className="lp-chip">Responde 24/7</span>
                  <span className="lp-chip">Cotiza y agenda</span>
                  <span className="lp-chip">Lee fotos y comprobantes</span>
                  <span className="lp-chip">Escribe como una persona</span>
                  <span className="lp-chip">Pasa a alguien cuando toca</span>
                </div>
              </article>

              {/* El copiloto, en sus dos caras: en el chat (la IA sugiere, una persona
                  aprueba) y en la cabecera del administrador (consulta, no cambia nada). */}
              <article className="lp-card lp-card--half lp-reveal">
                <h3>Copiloto en cada chat: la IA sugiere, tu equipo aprueba</h3>
                <p>
                  En modo Copiloto el agente redacta la respuesta y propone qué hacer con el lead; una persona la envía, la edita o la descarta, y hasta entonces no pasa nada. En el mismo chat te resume la conversación, responde «¿qué le ofrecimos?» con la ficha y el historial, mejora tu borrador y recuerda al cliente para la próxima vez.
                </p>
                <div className="lp-suggest" aria-hidden="true">
                  <div className="lp-suggest__head">
                    <span>Copiloto · respuesta sugerida</span>
                    <span className="lp-trace__ev">IA</span>
                  </div>
                  <div className="lp-suggest__text">Hola, Marco. El curso cuesta S/ 199 y la próxima fecha es el lunes 3. ¿Te separo un cupo?</div>
                  <div className="lp-suggest__acts">
                    <span>Pendiente:</span>
                    <span className="lp-chip">Etiqueta «interesado»</span>
                    <span className="lp-chip">Etapa → Calificado</span>
                  </div>
                  <div className="lp-suggest__btns">
                    <b>Enviar</b>
                    <span>Editar</span>
                    <span>Descartar</span>
                  </div>
                </div>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <h3>Y un copiloto para ti: pregúntale por qué algo no entró</h3>
                <p>
                  Si administras la cuenta, en la cabecera tienes un chat que lee la documentación y mira tu cuenta: números, agentes, equipo, embudos, formularios de Meta y los errores de los últimos días. Le preguntas cómo se configura algo o por qué no entró un lead y te responde con los pasos y el enlace a la pantalla. Solo consulta: no cambia nada sin ti.
                </p>
                <div className="lp-trace lp-trace--qa" aria-hidden="true">
                  <div className="lp-trace__row lp-trace__q">
                    <span>¿Por qué no entró el lead de Juan Ríos?</span>
                  </div>
                  <div className="lp-trace__row lp-trace__a">
                    <span>Llegó el martes por tu formulario de Meta sin número de teléfono, por eso no se creó el contacto. Te dejo el enlace para revisarlo en Integraciones.</span>
                  </div>
                </div>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <div className="lp-card__media">
                  <img
                    src="/landing/embudo.webp"
                    alt="El embudo de ventas de Driony con las etapas Nuevo, Contactado, Calificado, Propuesta y Ganado"
                    width={2241}
                    height={495}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Ningún lead se enfría sin que lo sepas</h3>
                <p>
                  Cada conversación nueva entra sola al embudo. En cada etapa decides qué pasa: un flujo al entrar, cuando el cliente escribe, cuando llega un webhook o si pasan días sin respuesta. Arrastras la oportunidad y el seguimiento se hace solo.
                </p>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <div className="lp-card__media lp-card__media--canvas">
                  <img
                    src="/landing/flujos.webp"
                    alt="El editor visual de flujos: un bloque de mensaje seguido de una condición por palabras clave"
                    width={1821}
                    height={1266}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Bienvenidas y menús sin programar</h3>
                <p>
                  Flujos de arrastrar bloques, o dictados a la IA. Respuestas por palabra clave con versiones por país o por datos del contacto: los métodos de pago de Perú no son los de México.
                </p>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <h3>Tus anuncios aprenden de tus ventas, no de tus clics</h3>
                <p>
                  Si el cliente llegó por un anuncio de Click to WhatsApp, Driony le cuenta a Meta cuándo se volvió potencial y cuándo compró (Conversions API). Tus campañas optimizan hacia clientes reales. Lo eliges etapa por etapa, y somos Meta Business Partner.
                </p>
                <div className="lp-trace" aria-hidden="true">
                  <div className="lp-trace__row">
                    <span>Calificado</span>
                    <span className="lp-trace__ev">LeadSubmitted</span>
                    <b className="lp-trace__ok">
                      <Check /> enviado
                    </b>
                  </div>
                  <div className="lp-trace__row">
                    <span>Ganado · S/ 250</span>
                    <span className="lp-trace__ev">Purchase</span>
                    <b className="lp-trace__ok">
                      <Check /> enviado
                    </b>
                  </div>
                </div>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <h3>Cotiza solo, en soles, dólares o pesos</h3>
                <p>
                  Importa tus productos desde Excel con precios en la moneda en la que vendas. El agente cotiza en la moneda del cliente y tú eliges qué campos de cada producto puede contar.
                </p>
                <div className="lp-trace" aria-hidden="true">
                  <div className="lp-trace__row">
                    <span>Curso de Python · online</span>
                    <span className="lp-trace__ev">S/ 199 · USD 55 · MXN 990</span>
                  </div>
                  <div className="lp-trace__row">
                    <span>productos.xlsx</span>
                    <b className="lp-trace__ok">
                      <Check /> 128 importados
                    </b>
                  </div>
                </div>
              </article>

              <article className="lp-card lp-card--third lp-reveal">
                <h3>Vuelve a venderle a quien ya te compró</h3>
                <p>Difusiones con plantillas aprobadas por Meta a la audiencia que elijas por etiquetas, y mides entregas y respuestas.</p>
                <div className="lp-meter" aria-hidden="true">
                  <div className="lp-meter__head">
                    <span>«Promo de septiembre» · aprobada</span>
                    <b>1.240 enviadas</b>
                  </div>
                  <div className="lp-meter__bar">
                    <span style={{ width: "78%" }} />
                  </div>
                  <div className="lp-meter__foot">
                    <span>Entregadas 96 %</span>
                    <span>Respondidas 312</span>
                  </div>
                </div>
              </article>

              <article className="lp-card lp-card--two-thirds lp-reveal">
                <h3>IA incluida en el plan, sin sorpresas en la factura</h3>
                <p>
                  Tu plan trae <b>tokens de IA incluidos</b> cada mes, sin claves ni configuración, y de ahí sale todo lo que hace la IA. Cuando quieras más, conectas OpenAI, Claude o cualquier API compatible con <b>tu</b> clave y eliges el modelo <b>por agente</b>, sin cupo y sin recargo. Cada respuesta registra lo que costó y cada agente tiene su <b>tope</b> mensual: al llegar, la IA se detiene y la conversación pasa a tu equipo.
                </p>
                <div className="lp-meter" aria-hidden="true">
                  <div className="lp-meter__head">
                    <span>Agente Ventas · este mes</span>
                    <b>31.200 / 50.000 tokens · $0,21</b>
                  </div>
                  <div className="lp-meter__bar">
                    <span style={{ width: "62%" }} />
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── Arma tu agente: rubro, misión y tono, y el chat que saldría; el botón lleva al alta con eso ── */}
        <section className="lp-section" id="rubros">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <p className="lp-tag">[ 03 // Arma tu agente ]</p>
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
        <section className="lp-section" id="como">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <p className="lp-tag">[ 04 // Puesta en marcha ]</p>
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
        <section className="lp-section" id="porque">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <p className="lp-tag">[ 05 // Antes y después ]</p>
              <h2>Lo que cambia desde la primera semana.</h2>
            </div>
            <div className="lp-vs lp-reveal" role="table" aria-label="WhatsApp a mano frente a Driony">
              <div className="lp-vs__row lp-vs__row--head" role="row">
                <span role="columnheader">WhatsApp a mano</span>
                <span role="columnheader">ARM con Driony</span>
              </div>
              {COMPARE.map(([bad, good]) => (
                <div className="lp-vs__row" role="row" key={bad}>
                  <span className="lp-vs__bad" role="cell">
                    <Minus />
                    {bad}
                  </span>
                  <span className="lp-vs__good" role="cell">
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
              <p className="lp-tag">[ 06 // Planes ]</p>
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
                  Los mensajes de WhatsApp los cobra Meta a tu cuenta, con un cupo gratis al mes por número. Sin billetera intermedia ni recargo. La IA va en el plan; con tu clave, sin cupo.
                </p>
              </div>
            </div>
            <div className="lp-plans lp-plans--snap lp-reveal">
              {PLAN_KEYS.map((k) => {
                const plan = PLANS[k];
                const pro = k === "pro";
                return (
                  <article className={`lp-plan lp-plan--snap${pro ? " lp-plan--cloud" : ""}`} key={k} data-plan={k}>
                    <div className="lp-plan__tag">{PLAN_TAG[k] ?? plan.name}</div>
                    <h3>{plan.name}</h3>
                    <p className="lp-price">
                      USD {plan.priceUsd}
                      <small>/mes</small>
                    </p>
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

            <div className="lp-faq lp-reveal">
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

        {/* ── Cierre: color de acción a todo ancho ── */}
        <section className="lp-cta-band">
          <div className="lp-wrap lp-cta-band__inner lp-reveal">
            <h2>Tu próximo lead escribe esta noche. ¿Quién le responde?</h2>
            <p>Pon un agente en tu número, dale tu catálogo y tus reglas, y deja de perder ventas en WhatsApp. Hoy, en dos minutos.</p>
            <div className="lp-cta__row">
              <Link href="/register" className="lp-btn lp-btn--white lp-btn--lg">
                Probar {TRIAL_DAYS} días gratis <Arrow />
              </Link>
              <Link href="/login" className="lp-btn lp-btn--outline lp-btn--lg">
                Iniciar sesión
              </Link>
            </div>
            <ul className="lp-cta-band__proof" aria-label="Sin riesgo">
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
        </section>
      </main>

      <MarketingFooter home />
    </div>
  );
}
