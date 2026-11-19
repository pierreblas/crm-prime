"use client";

import type React from "react";
import { splitReply, type PlaygroundToolCall } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { TOOL_COPY } from "./agentCopy";

// Cómo se ve una respuesta del agente en «Probar agente» y en el simulador.

/**
 * La respuesta del agente. Si escribe «como en WhatsApp» (varios mensajes
 * cortos), se parte igual que al enviarla de verdad (`splitReply`: un trozo
 * minúsculo se pega al siguiente y un párrafo largo se corta por frases).
 */
export function AgentBubbles({ text, split }: { text: string; split: boolean }) {
  const parts = split ? splitReply(text) : [text];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-agent-bubbles={parts.length}>
      {parts.map((p, i) => (
        <div key={i} style={bubbleStyle}>
          {whatsappFormat(p)}
        </div>
      ))}
    </div>
  );
}

// *negrita*, _cursiva_ y ~tachado~ como los pinta WhatsApp: dentro de una línea,
// pegados al texto (`* algo *` no cuenta).
const WA_FORMAT = /([*_~])(?=\S)([^\n]*?\S)\1(?![\p{L}\p{N}])/gu;

/** El texto con el formato de WhatsApp, para ver la respuesta como le llega al cliente. */
export function whatsappFormat(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(WA_FORMAT)) {
    const at = m.index!;
    // Solo al principio de una palabra: «2*3*4» no es negrita.
    if (at > 0 && /[\p{L}\p{N}]/u.test(text[at - 1]!)) continue;
    if (at > last) out.push(text.slice(last, at));
    const inner = m[2]!;
    out.push(m[1] === "*" ? <strong key={k++}>{inner}</strong> : m[1] === "_" ? <em key={k++}>{inner}</em> : <s key={k++}>{inner}</s>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Qué consultó el agente para responder y qué le devolvió cada consulta. En una
 * respuesta real, las acciones llevan además su estado (`statusLabel` dice
 * cómo nombrar los que no se aplicaron).
 */
export function ToolTrace({
  calls,
  statusLabel,
  label = "Qué consultó el agente",
}: {
  calls: (PlaygroundToolCall & { status?: string })[];
  statusLabel?: (status: string) => string | null;
  label?: string;
}) {
  return (
    <ul className="play-trace" aria-label={label} data-play-trace>
      {calls.map((c, i) => {
        const state = c.status && statusLabel ? statusLabel(c.status) : null;
        return (
          <li key={i} data-status={c.status}>
            <NavIcon name={TOOL_COPY[c.name]?.icon ?? "bolt"} size={12} />
            <span>
              <strong>{TOOL_COPY[c.name]?.title ?? c.name}</strong>
              {c.input ? <> {c.input}</> : null}
              <span className="play-trace__out"> → {c.summary}</span>
              {state && <span className="play-trace__state"> · {state}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}


const bubbleStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  color: "var(--text)",
  padding: "9px 12px",
  borderRadius: 10,
  fontSize: 14,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
