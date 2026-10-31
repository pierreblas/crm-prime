"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OnboardingStep, OnboardingStepKey } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { ProgressRing } from "./ProgressRing";
import { STEPS } from "./steps";
import { TOURS, requestTour } from "./tours";
import { useOnboarding, useOnboardingActions } from "./useOnboarding";

/**
 * Primeros pasos: la lista de configuración inicial, con seguimiento.
 *
 * Los pasos se marcan solos (la API los deduce de los datos). La página solo
 * decide qué contar y en qué orden: el primer paso pendiente va desplegado
 * con el detalle y el botón que lleva a la pantalla exacta; el resto,
 * plegado. Al volver de completar uno, el siguiente se despliega solo.
 */
export function GettingStarted({ role }: { role?: string }) {
  const isAdmin = role === "ADMIN";
  const { data, isPending, isError, refetch } = useOnboarding();
  const { skip, dismiss } = useOnboardingActions();
  const [expanded, setExpanded] = useState<OnboardingStepKey | null>(null);

  const byKey = new Map<OnboardingStepKey, OnboardingStep>(data?.steps.map((s) => [s.key, s]) ?? []);
  const statusOf = (key: OnboardingStepKey) => byKey.get(key)?.status ?? "pending";
  const firstPending = STEPS.find((s) => statusOf(s.key) === "pending")?.key ?? null;

  // El paso en curso va abierto; si el que estaba abierto se completó, se
  // pasa al siguiente. Nunca se cierra un paso abierto a mano por leerlo.
  useEffect(() => {
    if (!data) return;
    setExpanded((cur) => (cur && statusOf(cur) === "pending" ? cur : firstPending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isPending) {
    return (
      <div className="gs">
        <div className="skeleton" style={{ height: 96, borderRadius: 14 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 64, marginTop: 10 }} />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="gs">
        <p style={{ color: "var(--danger)" }}>No se pudo cargar Primeros pasos.</p>
        <button type="button" className="btn btn-ghost" onClick={() => void refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  const complete = data.done >= data.total;
  const pending = data.total - data.done;
  const pct = data.total ? data.done / data.total : 0;
  const minutes = STEPS.filter((s) => statusOf(s.key) === "pending").reduce((a, s) => a + s.minutes, 0);
  const completedOn = data.completedAt
    ? new Date(data.completedAt).toLocaleDateString("es", { day: "numeric", month: "long" })
    : null;

  return (
    <div className="gs">
      <header className="gs-hero">
        <div data-tour="gs-progress" style={{ flexShrink: 0 }}>
          <ProgressRing pct={pct} size={92} stroke={6}>
            {complete ? (
              <span style={{ color: "var(--positive)", display: "flex" }}>
                <NavIcon name="check" size={30} />
              </span>
            ) : (
              <span className="gs-hero__count">
                {data.done}
                <small>/{data.total}</small>
              </span>
            )}
          </ProgressRing>
        </div>
        <div className="gs-hero__text">
          <h1>{complete ? "Tu empresa está lista" : "Pon Driony en marcha"}</h1>
          <p>
            {complete
              ? `Completaste la configuración inicial${completedOn ? ` el ${completedOn}` : ""}. A partir de aquí, todo lo demás es vender.`
              : `${pending === 1 ? "Te falta 1 paso" : `Te faltan ${pending} pasos`}, unos ${minutes} minutos en total. Cada paso se marca solo cuando lo haces de verdad.`}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(!data.dismissedAt)}
            title={data.dismissedAt ? "Volver a mostrar la tarjeta en el menú lateral" : "Quitar la tarjeta del menú lateral; esta página sigue en Ayuda"}
          >
            {data.dismissedAt ? "Mostrar en el menú" : "Ocultar del menú"}
          </button>
        )}
      </header>

      {isAdmin && !data.setupCompletedAt && (
        <Link href="/bienvenida" className="gs-setup">
          <span className="gs-setup__icon" aria-hidden="true">
            <NavIcon name="sparkles" size={19} />
          </span>
          <span className="gs-setup__text">
            <strong>Arma tu IA de WhatsApp en unos minutos</strong>
            <span>Elige tu rubro y responde unas preguntas: Driony configura tu agente, lo que sabe y tu embudo de ventas.</span>
          </span>
          <span className="btn btn-primary btn-sm">
            Empezar <NavIcon name="arrow-right" size={14} />
          </span>
        </Link>
      )}

      {complete && (
        <section className="gs-next" aria-label="Siguientes pasos">
          <NextCard href="/difusiones" icon="megaphone" title="Difusiones" text="Envíos masivos con plantillas aprobadas por Meta." />
          <NextCard href="/flows" icon="flow" title="Flujos" text="Automatiza conversaciones paso a paso, sin código." />
          <NextCard href="/settings" icon="target" title="Anuncios de Meta" text="Leads de Lead Ads y click-to-WhatsApp, con atribución." />
          <NextCard href="/docs/api" icon="key" title="API y webhooks" text="Conecta Driony con tu sistema o con n8n." external />
        </section>
      )}

      <ol className="gs-steps" aria-label="Pasos de configuración">
        {STEPS.map((meta, i) => {
          const st = byKey.get(meta.key);
          const status = st?.status ?? "pending";
          const open = expanded === meta.key;
          const current = meta.key === firstPending;
          const sub =
            status === "done"
              ? `Hecho${st?.count != null && meta.count ? ` · ${meta.count(st.count)}` : ""}`
              : status === "skipped"
                ? "Omitido"
                : meta.why;
          return (
            <li
              key={meta.key}
              className={`gs-step is-${status}${open ? " is-open" : ""}${current ? " is-current" : ""}`}
              data-tour={current ? "gs-current" : undefined}
            >
              <button
                type="button"
                className="gs-step__head"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : meta.key)}
              >
                <span className="gs-step__mark" aria-hidden="true">
                  {status === "done" ? <NavIcon name="check" size={14} /> : status === "skipped" ? <NavIcon name="minus" size={14} /> : i + 1}
                </span>
                <span className="gs-step__text">
                  <span className="gs-step__title">{meta.title}</span>
                  <span className="gs-step__why">{sub}</span>
                </span>
                <span className="gs-step__meta">
                  {status === "pending" && <span className="gs-step__time">{meta.minutes} min</span>}
                  <span className="gs-step__chev">
                    <NavIcon name="chevron-down" size={15} />
                  </span>
                </span>
              </button>

              {open && (
                <div className="gs-step__body">
                  <ul>
                    {meta.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  <div className="gs-step__actions">
                    <Link href={meta.href} className={`btn ${status === "pending" ? "btn-primary" : "btn-ghost"}`}>
                      {status === "done" ? "Abrir" : meta.cta}
                      <NavIcon name="arrow-right" size={14} />
                    </Link>
                    {meta.doc && (
                      <a className="btn btn-ghost" href={`/docs/${meta.doc.slug}`} target="_blank" rel="noopener noreferrer">
                        <NavIcon name="book" size={14} />
                        {meta.doc.label}
                      </a>
                    )}
                    {isAdmin && status !== "done" && (
                      <button
                        type="button"
                        className="gs-step__skip"
                        disabled={skip.isPending}
                        onClick={() => skip.mutate({ key: meta.key, skipped: status !== "skipped" })}
                      >
                        {status === "skipped" ? "Retomar este paso" : "Omitir este paso"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <section className="gs-tours" aria-labelledby="gs-tours-title">
        <h2 id="gs-tours-title">Tours guiados</h2>
        <p>Un minuto por pantalla, señalando lo que importa. Se abren solos la primera vez que entras; aquí puedes repetirlos.</p>
        <ul className="gs-tour-list">
          {TOURS.map((tour) => {
            const seen = data.toursSeen.includes(tour.key);
            return (
              <li key={tour.key} className={`gs-tour${seen ? " is-seen" : ""}`}>
                <span className="gs-tour__icon">
                  <NavIcon name={tour.icon} size={16} />
                </span>
                <span className="gs-tour__name">{tour.name}</span>
                <span className="gs-tour__state">{seen ? "Visto" : "Nuevo"}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => requestTour(tour.key)}>
                  <NavIcon name="play" size={13} />
                  {seen ? "Repetir" : "Ver"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="gs-foot">
        ¿Te atascas en algo?{" "}
        <a href="/docs" target="_blank" rel="noopener noreferrer">
          Lee la documentación
        </a>
        {process.env.NEXT_PUBLIC_CONTACT_EMAIL && (
          <>
            {" "}
            o <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}`}>escríbenos</a>
          </>
        )}
        .
      </footer>
    </div>
  );
}

function NextCard({
  href,
  icon,
  title,
  text,
  external,
}: {
  href: string;
  icon: React.ComponentProps<typeof NavIcon>["name"];
  title: string;
  text: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <span className="gs-next__icon">
        <NavIcon name={icon} size={18} />
      </span>
      <span className="gs-next__title">{title}</span>
      <span className="gs-next__text">{text}</span>
    </>
  );
  return external ? (
    <a className="gs-next__card" href={href} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <Link className="gs-next__card" href={href}>
      {inner}
    </Link>
  );
}
