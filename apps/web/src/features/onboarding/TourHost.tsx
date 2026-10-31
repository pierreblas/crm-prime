"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { TourKey } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useOnboarding, useOnboardingActions } from "./useOnboarding";
import {
  TOUR_BY_KEY,
  TOUR_EVENT,
  TOUR_FORCE_KEY,
  tourForPath,
  type TourDef,
  type TourStep,
} from "./tours";

/**
 * Motor de los tours guiados. Vive en la cabecera de la app, una sola vez.
 *
 * Señala elementos REALES de la pantalla con un foco (todo lo demás se
 * oscurece) y una tarjeta al lado. No bloquea la página: la persona puede
 * pulsar lo que se le está enseñando, y el tour la sigue. Al terminar o
 * saltarlo se guarda como visto para ese usuario, en el servidor, así que no
 * vuelve a salir en otro dispositivo.
 *
 * Se abre de tres maneras: solo, la primera vez que se entra en una pantalla
 * con tour; a petición (evento TOUR_EVENT desde el menú de ayuda o la página
 * de Primeros pasos); o al llegar a la pantalla con una clave forzada en
 * sessionStorage (cuando se pidió el tour desde otra pantalla).
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}
type Placement = NonNullable<TourStep["placement"]>;
interface Active {
  def: TourDef;
  steps: TourStep[];
  index: number;
}

const PAD = 6; // aire entre el elemento y el borde del foco
const GAP = 14; // distancia del foco a la tarjeta
const MARGIN = 12; // margen mínimo con el borde de la ventana
const MOBILE = 640;

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  // Fuera de la ventana por los lados = oculto (el menú lateral plegado en
  // móvil). Por arriba o abajo no cuenta: ahí se llega con scroll.
  if (r.right <= 0 || r.left >= window.innerWidth) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TourHost() {
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useOnboarding();
  const { tourSeen } = useOnboardingActions();

  const [active, setActive] = useState<Active | null>(null);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 340, h: 170 });
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Qué pantalla ya intentó abrir su tour solo: una vez por visita.
  const autoTried = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Arranca cuando exista al menos un objetivo: la pantalla puede tardar en
  // pintar sus datos. Seis segundos y desiste sin ruido.
  const start = useCallback((def: TourDef) => {
    let tries = 0;
    const tick = () => {
      if (activeRef.current) return;
      const steps = def.steps.filter((s) => rectOf(document.querySelector(s.target)));
      if (steps.length > 0) {
        setActive({ def, steps, index: 0 });
        return;
      }
      if (++tries < 30) window.setTimeout(tick, 200);
    };
    tick();
  }, []);

  const finish = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    tourSeen.mutate(a.def.key);
    setActive(null);
  }, [tourSeen]);

  const go = useCallback(
    (delta: 1 | -1) => {
      const a = activeRef.current;
      if (!a) return;
      // Salta los pasos cuyo elemento ya no está (p. ej. se cerró un panel).
      let i = a.index + delta;
      while (i >= 0 && i < a.steps.length && !rectOf(document.querySelector(a.steps[i]!.target))) i += delta;
      if (i >= a.steps.length) {
        finish();
        return;
      }
      if (i < 0) return;
      setActive({ ...a, index: i });
    },
    [finish],
  );

  // Apertura automática o forzada al entrar en una pantalla.
  useEffect(() => {
    if (!data) return;
    const forced = window.sessionStorage.getItem(TOUR_FORCE_KEY) as TourKey | null;
    if (forced) {
      const def = TOUR_BY_KEY[forced];
      if (def?.matches(pathname)) {
        window.sessionStorage.removeItem(TOUR_FORCE_KEY);
        const t = window.setTimeout(() => start(def), 500);
        return () => window.clearTimeout(t);
      }
    }
    const def = tourForPath(pathname);
    if (!def || autoTried.current === pathname) return;
    autoTried.current = pathname;
    if (data.toursSeen.includes(def.key)) return;
    const t = window.setTimeout(() => {
      // Si la pantalla se abrió para algo concreto (el simulador o el asistente
      // del agente, desde un enlace), el tour no se le pone encima: queda sin
      // ver y sale la próxima vez.
      if (document.querySelector('aside[role="dialog"], [role="dialog"][aria-modal="true"]')) return;
      start(def);
    }, 700);
    return () => window.clearTimeout(t);
  }, [data, pathname, start]);

  // Cambiar de pantalla a mitad de tour lo cierra (y cuenta como visto).
  useEffect(() => {
    const a = activeRef.current;
    if (a && !a.def.matches(pathname)) finish();
  }, [pathname, finish]);

  // Petición explícita: desde Ayuda o desde Primeros pasos.
  useEffect(() => {
    const onRequest = (e: Event) => {
      const key = (e as CustomEvent<{ key: TourKey }>).detail?.key;
      const def = key ? TOUR_BY_KEY[key] : undefined;
      if (!def) return;
      if (def.matches(pathname)) {
        setActive(null);
        start(def);
      } else {
        window.sessionStorage.setItem(TOUR_FORCE_KEY, key);
        router.push(def.href);
      }
    };
    window.addEventListener(TOUR_EVENT, onRequest);
    return () => window.removeEventListener(TOUR_EVENT, onRequest);
  }, [pathname, router, start]);

  // Sigue al elemento señalado (scroll, cambios de tamaño, paneles que se
  // abren) mientras el paso está activo.
  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const step = active.steps[active.index]!;
    const el = document.querySelector(step.target);
    if (!el) {
      go(1);
      return;
    }
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    let raf = 0;
    const loop = () => {
      const r = rectOf(el);
      if (r) setRect((prev) => (sameRect(prev, r) ? prev : r));
      raf = window.requestAnimationFrame(loop);
    };
    loop();
    return () => window.cancelAnimationFrame(raf);
  }, [active, go]);

  // Teclado: flechas para moverse, Esc para salir. Solo cuando la persona no
  // está escribiendo en la página.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (!typing && (e.key === "ArrowRight" || e.key === "Enter")) {
        e.preventDefault();
        go(1);
      } else if (!typing && e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finish, go]);

  // Foco al abrir, para lectores de pantalla y teclado.
  useEffect(() => {
    if (active?.index === 0) cardRef.current?.focus({ preventScroll: true });
  }, [active?.def.key, active?.index]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.w) > 1 || Math.abs(r.height - cardSize.h) > 1) {
      setCardSize({ w: r.width, h: r.height });
    }
  });

  if (!mounted || !active || !rect) return null;

  const step = active.steps[active.index]!;
  const total = active.steps.length;
  const last = active.index === total - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < MOBILE;
  const pos = mobile ? null : place(rect, step.placement ?? "bottom", cardSize.w, cardSize.h, vw, vh);

  const spot: React.CSSProperties = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  const card: React.CSSProperties = pos ? { top: pos.top, left: pos.left } : {};
  const arrow: React.CSSProperties | null = pos
    ? pos.placement === "bottom" || pos.placement === "top"
      ? { left: clamp(rect.left + rect.width / 2 - pos.left, 18, cardSize.w - 18) }
      : { top: clamp(rect.top + rect.height / 2 - pos.top, 18, cardSize.h - 18) }
    : null;

  return createPortal(
    <div className="tour-layer">
      <div className="tour-spot" style={spot} />
      <div
        ref={cardRef}
        className={`tour-card${pos ? ` is-${pos.placement}` : " is-sheet"}`}
        style={card}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
      >
        {arrow && <span className="tour-card__arrow" style={arrow} aria-hidden="true" />}
        <div className="tour-card__step">
          <span className="tour-card__dots" aria-hidden="true">
            {active.steps.map((s, i) => (
              <span key={s.target} className={`tour-card__dot${i === active.index ? " is-on" : i < active.index ? " is-past" : ""}`} />
            ))}
          </span>
          <span>
            {active.index + 1} de {total} · {active.def.name}
          </span>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p id="tour-body">{step.body}</p>
        <div className="tour-card__actions">
          <button type="button" className="tour-card__skip" onClick={finish}>
            {last ? "Cerrar" : "Saltar tour"}
          </button>
          <span style={{ flex: 1 }} />
          {active.index > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(-1)}>
              Atrás
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => (last ? finish() : go(1))} autoFocus={false}>
            {last ? "Entendido" : "Siguiente"}
            {!last && <NavIcon name="arrow-right" size={14} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Dónde va la tarjeta: en el lado pedido si cabe; si no, el primero que
 * quepa (abajo, arriba, derecha, izquierda); si ninguno, abajo o arriba
 * según dónde esté el elemento, ceñido a la ventana.
 */
function place(
  r: Rect,
  pref: Placement,
  cw: number,
  ch: number,
  vw: number,
  vh: number,
): { top: number; left: number; placement: Placement } {
  const at = (p: Placement) => {
    switch (p) {
      case "bottom":
        return { top: r.top + r.height + PAD + GAP, left: r.left + r.width / 2 - cw / 2 };
      case "top":
        return { top: r.top - PAD - GAP - ch, left: r.left + r.width / 2 - cw / 2 };
      case "right":
        return { top: r.top + r.height / 2 - ch / 2, left: r.left + r.width + PAD + GAP };
      case "left":
        return { top: r.top + r.height / 2 - ch / 2, left: r.left - PAD - GAP - cw };
    }
  };
  const fits = (p: { top: number; left: number }) =>
    p.top >= MARGIN && p.left >= MARGIN && p.top + ch <= vh - MARGIN && p.left + cw <= vw - MARGIN;
  const settle = (p: { top: number; left: number }, placement: Placement) => ({
    top: clamp(p.top, MARGIN, Math.max(MARGIN, vh - ch - MARGIN)),
    left: clamp(p.left, MARGIN, Math.max(MARGIN, vw - cw - MARGIN)),
    placement,
  });

  const order: Placement[] = [pref, "bottom", "top", "right", "left"];
  for (const p of order) {
    const pos = at(p);
    if (fits(pos)) return settle(pos, p);
  }
  // Nada cabe entero (elemento grande): a un lado según el sitio libre.
  const below = vh - (r.top + r.height);
  const p: Placement = below >= r.top ? "bottom" : "top";
  return settle(at(p), p);
}
