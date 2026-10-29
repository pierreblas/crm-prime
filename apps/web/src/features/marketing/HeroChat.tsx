"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "./chrome";

// Una venta de principio a fin, en el orden en que pasa: el mensaje entra por
// un anuncio, el agente responde, lee el comprobante y el embudo y Meta se
// enteran solos. Datos inventados; nada de contactos reales.
type Msg = { side: "in" | "out"; text: string; file?: string; time: string };
type Log = { text: string; detail?: string };
type Beat = { msg?: Msg; log?: Log; wait: number };

const BEATS: Beat[] = [
  { msg: { side: "in", time: "21:42", text: "Hola, vi el anuncio del curso de Python. ¿Cuánto cuesta y cuándo empieza?" }, log: { text: "Lead nuevo", detail: "desde un anuncio" }, wait: 900 },
  { msg: { side: "out", time: "21:42", text: "¡Hola, Lucía! Cuesta S/ 199 y empieza el lunes 3, en vivo por Zoom. ¿Te separo un cupo?" }, log: { text: "Respondió en 4 s", detail: "agente Ventas" }, wait: 1900 },
  { msg: { side: "in", time: "21:44", text: "Sí, ya pagué por Yape", file: "comprobante.jpg" }, log: { text: "Comprobante leído", detail: "Yape · S/ 199" }, wait: 1500 },
  { msg: { side: "out", time: "21:44", text: "Recibido: S/ 199. Tu cupo está confirmado, te llega el enlace el domingo." }, log: { text: "Venta ganada", detail: "Calificado → Ganado" }, wait: 1600 },
  { log: { text: "Meta se entera", detail: "Purchase · S/ 199" }, wait: 1100 },
];
const LAST = BEATS.length;

/**
 * La conversación del hero. Sin JS (y con movimiento reducido) se pinta
 * completa; con JS se reproduce paso a paso una vez y se puede repetir.
 */
export function HeroChat() {
  // Empieza en el estado final: es lo que ve el HTML del servidor.
  const [step, setStep] = useState(LAST);
  const [typing, setTyping] = useState(false);
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(0);
    setTyping(false);
    let t = 500;
    BEATS.forEach((b, i) => {
      // Antes de cada respuesta del agente, «escribiendo…».
      if (b.msg?.side === "out") {
        timers.current.push(window.setTimeout(() => setTyping(true), t));
        t += 1100;
      }
      timers.current.push(
        window.setTimeout(() => {
          setTyping(false);
          setStep(i + 1);
        }, t),
      );
      t += b.wait;
    });
    return () => timers.current.forEach(clearTimeout);
  }, [run]);

  const done = step >= LAST;

  return (
    <figure className="lp-live" aria-label="Ejemplo: un agente de IA de Driony atiende y cierra una venta por WhatsApp">
      <div className="lp-live__chat">
        <header className="lp-live__head">
          <span className="lp-live__avatar" aria-hidden="true">
            LP
          </span>
          <span className="lp-live__who">
            <b>Lucía Pérez</b>
            <span>Llegó por un anuncio</span>
          </span>
          <span className="lp-live__mode">
            <i aria-hidden="true" /> Autopilot
          </span>
        </header>

        <ol className="lp-live__msgs">
          {BEATS.map((b, i) =>
            b.msg ? (
              <li key={i} className={`lp-msg lp-msg--${b.msg.side}`} data-on={i < step}>
                {b.msg.side === "out" && typing && step === i && (
                  <span className="lp-msg__typing" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                <div className="lp-msg__bubble">
                  {b.msg.file && (
                    <span className="lp-msg__file">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                      {b.msg.file}
                    </span>
                  )}
                  {b.msg.text}
                  <span className="lp-msg__meta">
                    {b.msg.side === "out" && <span className="lp-msg__ai">IA</span>}
                    {b.msg.time}
                  </span>
                </div>
              </li>
            ) : null,
          )}
        </ol>
      </div>

      <div className="lp-live__side">
        <p className="lp-live__label">Mientras tanto, en tu CRM</p>
        <ol className="lp-live__log">
          {BEATS.map((b, i) =>
            b.log ? (
              <li key={i} data-on={i < step} data-last={i === step - 1}>
                <span className="lp-live__tick" aria-hidden="true">
                  <Check />
                </span>
                <span>
                  <b>{b.log.text}</b>
                  {b.log.detail && <small>{b.log.detail}</small>}
                </span>
              </li>
            ) : null,
          )}
        </ol>
        <button type="button" className="lp-live__replay" onClick={() => setRun((r) => r + 1)} data-ready={done} aria-label="Ver la conversación otra vez">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Ver otra vez
        </button>
      </div>
    </figure>
  );
}
