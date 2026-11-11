"use client";

import { useEffect, useRef } from "react";
import * as piece from "./asciiAgentLog";
import { mountText } from "./asciiMount";

/**
 * El terminal del hero: el registro del agente escribiéndose debajo de la
 * captura. El servidor pinta el fotograma quieto (la primera escena entera),
 * así no hay hueco ni salto; al hidratar, se pone a escribir.
 */
export function HeroTerminal() {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return mountText(el, piece);
  }, []);
  return (
    <div
      className="lp-hero__term"
      role="img"
      aria-label="Registro del agente: lee el catálogo, responde al cliente, agenda la demo y avisa a tu vendedor"
      data-hero-terminal
    >
      <pre ref={ref} aria-hidden="true">
        {piece.default()(piece.meta.still)}
      </pre>
    </div>
  );
}
