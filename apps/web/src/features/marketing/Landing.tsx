"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import "./landing.css";

const GITHUB = "https://github.com/jusiho/crm-prime";
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contacto@driony.com";

// Secciones del nav: la etiqueta coincide con el título al que lleva.
const NAV = [
  { id: "capacidades", label: "Capacidades" },
  { id: "como", label: "Cómo funciona" },
  { id: "porque", label: "Por qué Driony" },
  { id: "planes", label: "Planes" },
];

// Frases de la banda violeta. Se pintan dos veces para que la marquesina
// haga un bucle sin salto.
const BAND_ITEMS = [
  "Tiempo real",
  "Multi-número",
  "Tu propio modelo de IA",
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
    a: "La IA se paga a tu proveedor (OpenAI, Anthropic o cualquier API compatible) con tu propia clave, no a Driony. Cada respuesta registra sus tokens y su coste en dólares, y puedes ponerle un tope mensual a cada agente.",
  },
  {
    q: "¿Qué incluye empezar gratis en la nube?",
    a: "Tu espacio en tu-empresa.driony.com con la bandeja, los agentes, los flujos y las difusiones, sin tarjeta. Si en algún momento hay un plan de pago que te aplique, te lo contamos antes de cobrarte nada.",
  },
  {
    q: "¿Puedo instalarlo yo en mi servidor?",
    a: "Sí. El código es abierto (AGPL-3.0) y se levanta con Docker Compose: base de datos, API y web. Tus datos se quedan en tu base y usas tu propia app de Meta y tus claves de IA.",
  },
];

export function Landing() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Reveals, estado del nav y sección activa. El contenido es visible por
  // defecto (sin JS); la clase lp-js solo añade la animación al hidratar.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add("lp-js");

    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

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
      window.removeEventListener("scroll", onScroll);
      reveal.disconnect();
      sections.disconnect();
    };
  }, []);

  // Menú móvil: bloquea el scroll, deja la página inerte (así el Tab no se
  // escapa del diálogo), cierra con Esc y devuelve el foco al botón.
  useEffect(() => {
    if (!menuOpen) return;
    const root = rootRef.current;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.setAttribute("inert", "");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      root?.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      burgerRef.current?.focus();
    };
  }, [menuOpen]);

  return (
    <div className="lp" ref={rootRef} lang="es">
      <a href="#contenido" className="lp-skip">
        Saltar al contenido
      </a>

      <header className="lp-nav" data-scrolled={scrolled}>
        <div className="lp-wrap lp-nav__inner">
          <Link href="/" className="lp-brand" aria-label="Driony, inicio">
            <span className="lp-brand__mark">
              <Logo />
            </span>
            Driony
          </Link>
          <nav className="lp-nav__links" aria-label="Secciones">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} aria-current={active === n.id ? "true" : undefined}>
                {n.label}
              </a>
            ))}
            <Link href="/docs">Docs</Link>
          </nav>
          <div className="lp-nav__cta">
            <Link href="/login" className="lp-nav__login">
              Iniciar sesión
            </Link>
            <Link href="/register" className="lp-btn lp-btn--primary">
              Empezar gratis
            </Link>
            <button
              ref={burgerRef}
              type="button"
              className="lp-burger"
              aria-label="Abrir menú"
              aria-expanded={menuOpen}
              aria-controls="lp-menu"
              onClick={() => setMenuOpen(true)}
            >
              <Burger />
            </button>
          </div>
        </div>
      </header>

      {menuOpen &&
        mounted &&
        createPortal(<MobileMenu onClose={() => setMenuOpen(false)} />, document.body)}

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
                  <b>Sin tarjeta.</b> Conectas tu número en minutos y usas la IA con tu propia
                  clave. Código abierto.
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

            <figure className="lp-shot lp-shot--hero lp-anim" style={{ animationDelay: "0.2s" }}>
              <img
                src="/landing/bandeja.webp"
                alt="La bandeja de Driony: conversaciones de WhatsApp de varios números, con filtros de pendientes y el agente de IA en modo Copilot"
                width={2160}
                height={1350}
                decoding="async"
                fetchPriority="high"
              />
            </figure>
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

            <div className="lp-bento">
              <article className="lp-card lp-card--wide lp-card--feature lp-reveal">
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
                <h3>Un agente de IA que atiende por ti</h3>
                <p>
                  Responde al instante, entiende qué busca el cliente, lo califica y
                  agenda. Cuando el caso lo pide, lo pasa a una persona de tu equipo.
                  Responde con <b>tu</b> información, porque lee tu catálogo y tu base
                  de conocimiento.
                </p>
                <div className="lp-mini">
                  <span className="lp-chip">Responde 24/7</span>
                  <span className="lp-chip">Califica y agenda</span>
                  <span className="lp-chip">Pasa a una persona cuando toca</span>
                  <span className="lp-chip">Tú apruebas cada respuesta, o la envía sola</span>
                </div>
              </article>

              <article className="lp-card lp-card--tall lp-reveal">
                <div className="lp-card__media">
                  <img
                    src="/landing/bandeja-lista.webp"
                    alt="Lista de conversaciones con filtros: todas, sin asignar, mías, y cuánto lleva esperando cada cliente"
                    width={540}
                    height={930}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Bandeja en tiempo real</h3>
                <p>
                  Todos tus números en una bandeja viva, con dueño claro, avisos y
                  el tiempo que lleva esperando cada cliente.
                </p>
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
                <h3>Embudo de ventas</h3>
                <p>
                  Cada conversación nueva entra sola al embudo. Arrastras la
                  oportunidad de etapa y no pierdes el seguimiento.
                </p>
              </article>

              <article className="lp-card lp-card--half lp-reveal">
                <div className="lp-card__media">
                  <img
                    src="/landing/flujos.webp"
                    alt="El editor visual de flujos: un bloque de mensaje seguido de una condición por palabras clave"
                    width={1821}
                    height={1266}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>Flujos sin código</h3>
                <p>
                  Bienvenidas, menús y preguntas encadenadas con un editor de
                  arrastrar, o dictados a la IA.
                </p>
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

              <article className="lp-card lp-card--third lp-reveal">
                <h3>Trae tu propio modelo</h3>
                <p>
                  OpenAI, Claude o cualquier API compatible con OpenAI, con <b>tu</b>{" "}
                  clave. El modelo se elige <b>por agente</b>: uno rápido y barato para
                  las preguntas de siempre, uno potente para la venta que lo merece.
                </p>
                <div className="lp-mini">
                  <span className="lp-chip">OpenAI</span>
                  <span className="lp-chip">Claude</span>
                  <span className="lp-chip">API compatible con OpenAI</span>
                  <span className="lp-chip">Modelo por agente</span>
                </div>
              </article>

              <article className="lp-card lp-card--third lp-reveal">
                <h3>Sabes cuánto gasta cada agente</h3>
                <p>
                  Cada respuesta registra sus tokens y su coste en dólares. Ves el
                  gasto del mes por agente y le pones un <b>tope</b>: al llegar, la IA
                  se detiene y la conversación pasa a tu equipo.
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
                <p>El agente atiende y califica cada lead; tu equipo solo entra a cerrar.</p>
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
            <div className="lp-compare lp-reveal">
              <div className="lp-col lp-col--bad">
                <div className="lp-col__label">WhatsApp a mano</div>
                {[
                  "Leads que esperan horas por una respuesta",
                  "Mensajes que se pierden entre vendedores",
                  "Responder uno por uno, todo el día",
                  "Sin saber en qué quedó cada conversación",
                  "Sin saber cuántos leads se enfriaron sin respuesta",
                ].map((t) => (
                  <div className="lp-row" key={t}>
                    <span className="lp-row__ic">
                      <Minus />
                    </span>
                    {t}
                  </div>
                ))}
              </div>
              <div className="lp-col lp-col--good">
                <div className="lp-col__label">Con Driony</div>
                {[
                  "Respuesta en segundos, las 24 horas",
                  "Todo en una bandeja, con dueño claro",
                  "La IA responde y califica por ti",
                  "Cada lead con su historial, etapa y notas",
                  "Cada conversación nueva entra al embudo y se asigna sola",
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
                  los de cualquier otra empresa. Si algún día hay un plan de pago que te
                  aplique, lo sabrás antes de que te cobremos nada.
                </p>
                <div className="lp-plan__rows">
                  {[
                    "Alta inmediata con tu propio subdominio",
                    "Conecta WhatsApp desde el panel",
                    "Actualizaciones y copias de seguridad incluidas",
                    "Aislamiento por empresa, también en la base de datos",
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
              revés? Es el mismo esquema de datos: se migra, no se rehace.
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

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot__inner">
          <span className="lp-brand" style={{ fontSize: 16 }}>
            <span className="lp-brand__mark" style={{ width: 26, height: 26 }}>
              <Logo />
            </span>
            Driony
          </span>
          <nav className="lp-foot__links" aria-label="Pie de página">
            <a href="#capacidades">Capacidades</a>
            <Link href="/docs">Documentación</Link>
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href={`mailto:${CONTACT}`}>Contacto</a>
            <Link href="/privacy">Privacidad</Link>
          </nav>
          <span className="lp-foot__right">
            <span className="lp-partner lp-partner--foot" title="Driony forma parte del programa de partners de Meta">
              <MetaMark />
              Meta Business Partner
            </span>
            <span>© 2026 Driony</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ── Menú móvil: <dialog> modal (trampa de foco y Esc nativos), por portal ── */
function MobileMenu({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const firstRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    firstRef.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="lp lp-menu"
      id="lp-menu"
      aria-label="Menú"
      lang="es"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="lp-menu__top">
        <span className="lp-brand">
          <span className="lp-brand__mark">
            <Logo />
          </span>
          Driony
        </span>
        <button type="button" className="lp-menu__close" aria-label="Cerrar menú" onClick={onClose}>
          <Close />
        </button>
      </div>
      <nav className="lp-menu__links" aria-label="Secciones">
        {NAV.map((n, i) => (
          <a key={n.id} href={`#${n.id}`} onClick={onClose} ref={i === 0 ? firstRef : undefined}>
            {n.label}
          </a>
        ))}
        <Link href="/docs" onClick={onClose}>
          Docs
        </Link>
      </nav>
      <div className="lp-menu__cta">
        <Link href="/register" className="lp-btn lp-btn--primary lp-btn--lg" onClick={onClose}>
          Empezar gratis <Arrow />
        </Link>
        <Link href="/login" className="lp-btn lp-btn--ghost lp-btn--lg" onClick={onClose}>
          Iniciar sesión
        </Link>
      </div>
    </dialog>
  );
}

/* ── Iconografía (línea coherente, trazo 1.75) ── */
const S = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function Logo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11.5a8 8 0 1 1 3.2 6.4L4 19l1.1-3.2A7.9 7.9 0 0 1 4 11.5Z" />
      <path d="M9 10.5c.4 2.2 2.3 4.1 4.5 4.5" />
    </svg>
  );
}
/** Logotipo de Meta, monocromo (hereda el color del texto). */
function MetaMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" />
    </svg>
  );
}

function Burger() {
  return (
    <svg {...S} width="20" height="20">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function Close() {
  return (
    <svg {...S} width="20" height="20">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg {...S} width="17" height="17">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function Check() {
  return (
    <svg {...S} width="16" height="16">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function Minus() {
  return (
    <svg {...S} width="16" height="16">
      <path d="M5 12h14" />
    </svg>
  );
}
function Pause() {
  return (
    <svg {...S} width="16" height="16" fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function Play() {
  return (
    <svg {...S} width="16" height="16" fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}
function IconGit() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
