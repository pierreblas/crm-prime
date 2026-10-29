"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./landing.css";
import { Arrow, Check, GITHUB, IconGit, LpThemeScript, MarketingFooter, MarketingHeader, MetaMark, Minus, NAV, Pause, Play } from "./chrome";
import { HeroChat } from "./HeroChat";

// Antes y después, emparejados: cada problema al lado de lo que lo resuelve.
const COMPARE = [
  ["Leads que esperan horas por una respuesta", "Respuesta en segundos, las 24 horas"],
  ["Mensajes que se pierden entre vendedores", "Todo en una bandeja, con dueño claro"],
  ["Responder uno por uno, todo el día", "La IA responde y califica por ti"],
  ["Sin saber en qué quedó cada conversación", "Cada lead con su historial, etapa y notas"],
  ["Leads que se enfrían sin que nadie lo note", "Cada conversación entra al embudo y se asigna sola"],
  ["Comprobantes en foto que nadie revisa a tiempo", "La IA entiende la foto y pasa el chat a tu equipo"],
  ["Anuncios que optimizan a clics, no a ventas", "Meta aprende de tus ventas reales y trae mejores leads"],
];

// Frases de la banda violeta. Se pintan dos veces para que la marquesina
// haga un bucle sin salto.
const BAND_ITEMS = [
  "Tiempo real",
  "Multi-número",
  "IA incluida o tu propia clave",
  "Meta Business Partner",
  "Anuncios que aprenden de tus ventas",
  "Gasto bajo control",
  "Código abierto",
  "Agentes que venden 24/7",
];

const FAQ = [
  {
    q: "¿Necesito un número nuevo de WhatsApp?",
    a: "No. Conectas tu número de WhatsApp Business desde el panel, con la ventana oficial de Meta (Driony es Meta Business Partner). Si ya lo usas en la app del celular, seguir usándolo a la vez (Coexistencia) depende de que Meta apruebe a la plataforma; mientras tanto el número se atiende desde el CRM.",
  },
  {
    q: "¿Cuánto cuesta la inteligencia artificial?",
    a: "Cada plan trae conversaciones con IA incluidas al mes (100 en Gratis, 2.000 en Pro y 10.000 en Empresa), sin configurar nada. Si prefieres otro modelo o no tener cupo, conectas tu clave de OpenAI, Anthropic o cualquier API compatible y pagas a tu proveedor a su precio, sin recargo. Cada respuesta registra sus tokens y su coste, y puedes ponerle un tope mensual a cada agente.",
  },
  {
    q: "¿Qué incluye empezar gratis en la nube?",
    a: "Tu espacio en tu-empresa.driony.com con la bandeja, los agentes de IA, el embudo y los flujos, sin tarjeta, para un número de WhatsApp y dos personas del equipo. Los planes Pro y Empresa amplían números, usuarios, difusiones y API; están en la página de precios.",
  },
  {
    q: "¿Cómo sé cuándo la IA pasó un chat a una persona?",
    a: "En la bandeja: la conversación se marca «Pasado a humano» con el motivo, y el agente deja de responder solo hasta que alguien de tu equipo la atiende. Tú decides cuándo debe hacerlo: cuando no esté seguro, cuando el cliente lo pida o, por ejemplo, siempre que mande una imagen o un comprobante.",
  },
  {
    q: "¿La IA entiende audios, fotos y documentos?",
    a: "Sí. Transcribe los audios y describe las imágenes y documentos con tu proveedor de IA, y usa eso para responder. Si no puede ver una imagen, lo dice y pasa el chat a tu equipo en vez de inventar.",
  },
  {
    q: "¿Mis anuncios de Meta se enteran de las ventas?",
    a: "Sí. Activa las conversiones en Integraciones y elige en cada etapa del embudo qué evento se envía a Meta (LeadSubmitted, Purchase con el valor de la venta, u otros). Solo se envían para chats que llegaron por un anuncio de Click to WhatsApp, y cada evento una sola vez por oportunidad.",
  },
  {
    q: "¿Puedo instalarlo yo en mi servidor?",
    a: "Sí. El código es abierto (AGPL-3.0) y se levanta con Docker Compose: base de datos, API y web. Tus datos se quedan en tu base y usas tu propia app de Meta y tus claves de IA.",
  },
];

export function Landing() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  // Reveals y sección activa. El contenido es visible por defecto (sin JS);
  // la clase lp-js solo añade la animación al hidratar.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add("lp-js");

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            reveal.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    root.querySelectorAll(".lp-reveal").forEach((el) => reveal.observe(el));

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
      reveal.disconnect();
      sections.disconnect();
    };
  }, []);

  return (
    <div className="lp" id="lp-root" ref={rootRef} lang="es" suppressHydrationWarning>
      <LpThemeScript />
      <a href="#contenido" className="lp-skip">
        Saltar al contenido
      </a>
      <MarketingHeader active={active} home />


      <main id="contenido">
        {/* ── Hero: titular + el producto de verdad ── */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero__grid">
            <div>
              <p className="lp-hero__kicker lp-anim" style={{ animationDelay: "0.02s" }}>
                CRM para equipos que venden por WhatsApp
              </p>
              <h1 className="lp-anim" style={{ animationDelay: "0.08s" }}>
                Convierte WhatsApp en tu mejor <span className="lp-hero__accent">vendedor</span>.
              </h1>
              <p className="lp-hero__sub lp-anim" style={{ animationDelay: "0.16s" }}>
                Agentes de IA que responden, califican y agendan a tus leads en
                segundos, las 24 horas, desde tu propio número.
              </p>
              <div className="lp-hero__cta lp-anim" style={{ animationDelay: "0.24s" }}>
                <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg">
                  Empezar gratis <Arrow />
                </Link>
                <a href="#como" className="lp-btn lp-btn--ghost lp-btn--lg">
                  Ver cómo funciona
                </a>
              </div>
              <div className="lp-hero__trust lp-anim" style={{ animationDelay: "0.32s" }}>
                <Check />
                <span>
                  <b>Sin tarjeta.</b> Conectas tu número en minutos y el agente de IA ya viene
                  incluido. Código abierto.
                </span>
              </div>
              <div className="lp-partner lp-anim" style={{ animationDelay: "0.4s" }} title="Driony forma parte del programa de partners de Meta">
                <MetaMark />
                <span>
                  <b>Meta Business Partner</b>
                  <span className="lp-partner__sub">API oficial de WhatsApp Business</span>
                </span>
              </div>
            </div>

            <div className="lp-anim" style={{ animationDelay: "0.2s" }}>
              <HeroChat />
            </div>
          </div>
        </section>

        {/* ── Banda violeta a todo ancho, en marquesina ── */}
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

        {/* ── Capacidades ── */}
        <section className="lp-section" id="capacidades">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Toda tu operación de ventas, en una sola pantalla.</h2>
              <p className="lp-lede">
                Deja de saltar entre el celular, hojas de cálculo y notas sueltas.
                Driony junta tus conversaciones, tu embudo y tu IA en un mismo lugar.
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
                  <b>La IA a la vista.</b> Responde sola, te sugiere la respuesta o se aparta: lo eliges por conversación.
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
                    width={1230}
                    height={768}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Un agente de IA que atiende como tu mejor vendedor</h3>
                <p>
                  Responde con <b>tu</b> información: tu catálogo, tu base de
                  conocimiento y los datos de cada contacto. Recuerda al cliente de una
                  conversación a la siguiente, mueve la oportunidad de etapa y, cuando el
                  caso lo pide, pasa el chat a tu equipo y lo deja claro en la bandeja.
                </p>
                <div className="lp-mini">
                  <span className="lp-chip">Responde 24/7</span>
                  <span className="lp-chip">Califica y agenda</span>
                  <span className="lp-chip">Entiende fotos y comprobantes</span>
                  <span className="lp-chip">Escribe como una persona</span>
                  <span className="lp-chip">Pasa a una persona cuando toca</span>
                </div>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <div className="lp-card__media">
                  <img
                    src="/landing/embudo.webp"
                    alt="El embudo de ventas de Driony con las etapas Nuevo, Contactado, Calificado, Propuesta y Ganado"
                    width={2241}
                    height={630}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Embudo con automatizaciones por etapa</h3>
                <p>
                  Cada conversación nueva entra sola al embudo. En cada etapa decides qué
                  pasa: un flujo al entrar, cuando el cliente escribe, cuando llega un
                  webhook o si pasan días sin respuesta. Arrastras la oportunidad y no
                  pierdes el seguimiento.
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
                <h3>Flujos y respuestas sin código</h3>
                <p>
                  Bienvenidas, menús y preguntas encadenadas con un editor de
                  arrastrar, o dictados a la IA. Respuestas por palabra clave con
                  versiones por país o por datos del contacto: los métodos de pago de
                  Perú no son los de México.
                </p>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <h3>Anuncios que aprenden de tus ventas</h3>
                <p>
                  Si el cliente llegó por un anuncio de Click to WhatsApp, Driony le
                  cuenta a Meta cuándo se volvió potencial y cuándo compró (Conversions
                  API). Tus campañas optimizan hacia clientes reales, no hacia clics.
                  Lo eliges etapa por etapa, y somos Meta Business Partner.
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
                <h3>Catálogo con precios en varias monedas</h3>
                <p>
                  Importa tus productos desde Excel con precios en soles, dólares o la
                  moneda en la que vendas. El agente cotiza en la moneda del cliente y tú
                  eliges qué campos de cada producto puede contar.
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
                <h3>Difusiones y plantillas</h3>
                <p>
                  Envía campañas con plantillas aprobadas por Meta a la audiencia
                  que elijas por etiquetas, y mide entregas y respuestas.
                </p>
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
                <h3>IA incluida, o tu modelo con tu clave</h3>
                <p>
                  Tu plan trae <b>conversaciones con IA incluidas</b> cada mes, sin
                  configurar nada. Cuando quieras más, conectas OpenAI, Claude o
                  cualquier API compatible con <b>tu</b> clave y eliges un modelo
                  distinto <b>por agente</b>, sin cupo y sin recargo. Cada respuesta
                  registra lo que costó y cada agente tiene su <b>tope</b> mensual: al
                  llegar, la IA se detiene y la conversación pasa a tu equipo.
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

        {/* ── Cómo funciona: una secuencia real de tres pasos ── */}
        <section className="lp-section" id="como">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>De WhatsApp a venta en tres pasos.</h2>
              <p className="lp-lede">
                Sin migraciones eternas ni semanas de implementación. Conectas y empiezas.
              </p>
            </div>
            <ol className="lp-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <li className="lp-step lp-reveal">
                <div className="lp-step__n" aria-hidden="true">1</div>
                <h3>Conecta tu WhatsApp</h3>
                <p>Enlaza tu número de WhatsApp Business desde el panel, en minutos y sin tocar código. Driony es Meta Business Partner: la conexión es la oficial de Meta.</p>
              </li>
              <li className="lp-step lp-reveal">
                <div className="lp-step__n" aria-hidden="true">2</div>
                <h3>Entrena tu agente</h3>
                <p>
                  Dale tu información, tu tono y tus reglas. Decide cuándo responde solo y
                  cuándo pasa a una persona. Si no sabes por dónde empezar, el asistente
                  redacta las instrucciones contigo.
                </p>
              </li>
              <li className="lp-step lp-reveal">
                <div className="lp-step__n" aria-hidden="true">3</div>
                <h3>Empieza a vender</h3>
                <p>El agente atiende y califica cada lead; tu equipo solo entra a cerrar. Y si el cliente llegó por un anuncio, Meta se entera de la venta.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* ── Por qué Driony ── */}
        <section className="lp-section" id="porque">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>La diferencia entre responder tarde y cerrar la venta.</h2>
            </div>
            <div className="lp-vs lp-reveal" role="table" aria-label="WhatsApp a mano frente a Driony">
              <div className="lp-vs__row lp-vs__row--head" role="row">
                <span role="columnheader">WhatsApp a mano</span>
                <span role="columnheader">Con Driony</span>
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

        {/* ── Planes: open source / nube ── */}
        <section className="lp-section" id="planes">
          <div className="lp-wrap">
            <div className="lp-head lp-reveal">
              <h2>Dos formas de tener Driony.</h2>
              <p className="lp-lede">
                El mismo CRM, con el mismo código abierto en el núcleo. Elige si lo
                instalas tú o si lo alojamos nosotros.
              </p>
            </div>
            <div className="lp-plans">
              <article className="lp-plan lp-reveal">
                <div className="lp-plan__tag">Código abierto · AGPL-3.0</div>
                <h3>Instálalo en tu servidor</h3>
                <p className="lp-plan__price">Gratis, para siempre</p>
                <p>
                  El CRM completo para una empresa, con tus datos en tu base y tus
                  propias claves. Lo levantas con Docker en tu servidor y no dependes de
                  nadie.
                </p>
                <div className="lp-plan__rows">
                  {[
                    "Código abierto en GitHub",
                    "Una empresa, usuarios y números sin límite",
                    "Se instala con Docker en tu propio servidor",
                    "Tu app de Meta y tus claves de IA",
                    "Bandeja, agentes, flujos y difusiones incluidos",
                  ].map((t) => (
                    <div className="lp-row" key={t}>
                      <span className="lp-row__ic">
                        <Check />
                      </span>
                      {t}
                    </div>
                  ))}
                </div>
                <div className="lp-plan__cta">
                  <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--ghost">
                    <IconGit /> Ver en GitHub
                  </a>
                </div>
              </article>

              <article className="lp-plan lp-plan--cloud lp-reveal">
                <div className="lp-plan__tag">Nube · gestionado por Driony</div>
                <h3>Nosotros lo alojamos</h3>
                <p className="lp-plan__price">Empieza gratis, sin tarjeta</p>
                <p>
                  Tu espacio en <b>tu-empresa.driony.com</b> en dos minutos. Sin
                  servidores ni actualizaciones que hacer, y con tus datos aislados de
                  los de cualquier otra empresa. Empiezas en el plan Gratis; cuando
                  crezcas, Pro y Empresa amplían números, usuarios y características
                  (<Link href="/precios">ver precios</Link>).
                </p>
                <div className="lp-plan__rows">
                  {[
                    "Alta inmediata con tu propio subdominio",
                    "Conecta WhatsApp desde el panel",
                    "Actualizaciones y copias de seguridad incluidas",
                    "Aislamiento por empresa, también en la base de datos",
                    "Conversiones de anuncios a Meta, como Meta Business Partner",
                    "Soporte por correo de quien hace el producto",
                  ].map((t) => (
                    <div className="lp-row" key={t}>
                      <span className="lp-row__ic">
                        <Check />
                      </span>
                      {t}
                    </div>
                  ))}
                </div>
                <div className="lp-plan__cta">
                  <Link href="/register" className="lp-btn lp-btn--primary">
                    Empezar gratis <Arrow />
                  </Link>
                </div>
              </article>
            </div>
            <p className="lp-plans__note lp-reveal">
              ¿Empiezas con la versión de código abierto y luego quieres la nube, o al
              revés? Es el mismo esquema de datos: se migra, no se rehace.{" "}
              <Link href="/precios" className="lp-plans__link">
                Ver precios y límites de cada plan <Arrow />
              </Link>
            </p>

            <div className="lp-faq lp-reveal">
              <h3>Preguntas frecuentes</h3>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Cierre: violeta a todo ancho ── */}
        <section className="lp-cta-band">
          <div className="lp-wrap lp-cta-band__inner lp-reveal">
            <h2>Pon a tu agente a vender hoy.</h2>
            <p>
              Conecta tu número, entrena tu IA y deja de perder leads en WhatsApp.
              Sin tarjeta.
            </p>
            <div className="lp-cta__row">
              <Link href="/register" className="lp-btn lp-btn--white lp-btn--lg">
                Empezar gratis <Arrow />
              </Link>
              <Link href="/login" className="lp-btn lp-btn--outline lp-btn--lg">
                Iniciar sesión
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter home />
    </div>
  );
}
