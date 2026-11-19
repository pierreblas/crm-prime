import {
  simulationFindingKinds,
  simulationVerdicts,
  type SimulateReviewRequest,
  type SimulationFinding,
  type SimulationFindingKind,
  type SimulationVerdict,
} from "@crm/shared";

/**
 * La revisión de una conversación del simulador: una IA la juzga como lo
 * haría el dueño del negocio, pero con lo que el agente consultó de verdad a
 * la vista (el catálogo y el conocimiento que le devolvieron), para saber si
 * un precio, una fecha o un dato de pago salió de ahí o se lo inventó.
 */

/** Cuánto de las instrucciones del agente se le pasa: los datos válidos suelen estar ahí. */
const INSTRUCTIONS_MAX = 6000;

/**
 * El modelo que revisa: uno que razona comprueba mucho mejor si un dato salió
 * de lo consultado (con gpt-4.1-mini, el del agente, marcaba como inventados
 * datos que sí estaban). Si la empresa usa otro proveedor, el proveedor lo
 * cambia por el de Ajustes; con la IA incluida va su modelo.
 */
export const SIMULATION_REVIEW_MODEL = "gpt-5-mini";

export const SIMULATION_REVIEW_SYSTEM = [
  "Revisas una conversación de prueba entre un cliente simulado y el agente de IA de un negocio, por WhatsApp. Juzgas solo al agente, como lo haría el dueño del negocio.",
  "Lo que dijo el agente está en las líneas «AGENTE dijo». Debajo, lo que le devolvió el sistema al consultar: eso NO lo dijo el agente, es lo que sabía. Cita solo frases que dijo el agente.",
  "Revisa, en este orden:",
  "1. Datos inventados (lo más grave): precios, fechas, horarios, enlaces, datos de pago, certificados, condiciones o características que el agente afirmó y que NO están ni en lo que consultó ni en sus instrucciones. Cuenta como válido todo lo que le devolvieron en cualquier turno de la conversación, incluida la descripción de cada producto. Afirmar que algo NO se incluye o no existe sin que lo diga lo consultado también es inventar. Decir que no tiene un dato no es inventar.",
  "Lo que consultó puede venir recortado (termina en «…»): si un dato pudo estar en la parte que falta, no lo marques como inventado.",
  "2. Preguntas del cliente sin responder, o respuestas vagas cuando el dato sí estaba.",
  "3. Siguiente paso: si el cliente mostró interés, ¿le propuso avanzar (inscribirse, pagar, agendar)? Revisa todos sus mensajes antes de decir que no lo hizo.",
  "4. Pasar a una persona: ¿lo hizo cuando tocaba (lo pidió, está molesto, faltaba un dato importante)? ¿O lo pasó sin necesidad?",
  "5. Forma: mensajes demasiado largos o robóticos para WhatsApp, repetir lo mismo, no adaptarse a lo que dice el cliente.",
  "Veredicto: «bad» si inventó algún dato o trató mal al cliente; «review» si hay algo que mejorar; «ok» si atendió bien.",
  "Hallazgos: como mucho 4, los más importantes, en español sencillo para alguien que no es técnico; cada nota, de 25 palabras como mucho. Si citas al agente, copia su frase exacta (corta). Si estuvo bien, incluye un hallazgo «good» con lo que hizo bien.",
  'Responde solo con JSON: {"verdict": "ok|review|bad", "summary": "una frase", "findings": [{"kind": "invented|unanswered|no_next_step|handoff|tone|good", "note": "…", "quote": "…" o null}]}',
].join("\n");

const END_TEXT: Record<string, string> = {
  customer_done: "el cliente se despidió",
  escalated: "el agente pasó el chat a una persona",
  max_turns: "se llegó al tope de mensajes",
  error: "falló la simulación",
};

/** Lo que lee el revisor: instrucciones del agente, situación del cliente y la conversación con sus consultas. */
export function simulationReviewInput(input: SimulateReviewRequest, instructions: string): string {
  const lines = input.lines.map((l) => {
    if (l.who === "customer") return `CLIENTE: ${l.text}`;
    const extra = [
      l.consulted.length
        ? `  Lo que le devolvió el sistema al consultar (no lo dijo el agente):\n${l.consulted.map((c) => `    - ${c.replace(/\n/g, "\n      ")}`).join("\n")}`
        : "",
      l.options.length ? `  Botones que ofreció: ${l.options.join(" · ")}` : "",
      l.handoff ? `  Pasó el chat a una persona: ${l.handoff}` : "",
    ].filter(Boolean);
    return [`AGENTE dijo: «${l.text || "(sin mensaje)"}»`, ...extra].join("\n");
  });
  const prompt = instructions.trim();
  return [
    `## Instrucciones del agente${prompt.length > INSTRUCTIONS_MAX ? " (recortadas)" : ""}\n${prompt.slice(0, INSTRUCTIONS_MAX) || "(sin instrucciones)"}`,
    `## Situación del cliente simulado\n${input.scenario.title}: ${input.scenario.brief}`,
    `## Conversación${input.ended ? ` (terminó porque ${END_TEXT[input.ended] ?? input.ended})` : ""}\n${lines.join("\n")}`,
  ].join("\n\n");
}

/** El veredicto del JSON del modelo; si no se entiende, null. */
export function parseSimulationReview(raw: string): { verdict: SimulationVerdict; summary: string; findings: SimulationFinding[] } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: { verdict?: unknown; summary?: unknown; findings?: unknown };
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const verdict = (simulationVerdicts as readonly string[]).includes(String(parsed.verdict)) ? (parsed.verdict as SimulationVerdict) : null;
  if (!verdict) return null;
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .map((f) => f as { kind?: unknown; note?: unknown; quote?: unknown })
    .filter((f) => (simulationFindingKinds as readonly string[]).includes(String(f.kind)) && typeof f.note === "string" && f.note.trim())
    .slice(0, 4)
    .map((f) => ({
      kind: f.kind as SimulationFindingKind,
      note: String(f.note).trim().slice(0, 400),
      quote: typeof f.quote === "string" && f.quote.trim() ? f.quote.trim().slice(0, 300) : null,
    }));
  return { verdict, summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 300) : "", findings };
}

/** Para comparar citas: minúsculas, sin tildes, sin signos ni espacios repetidos. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Los hallazgos con los pies en el suelo: si uno cita una frase que el agente
 * no dijo (el revisor a veces cita lo que devolvió el sistema), se descarta.
 * Si con eso desaparecen los datos inventados, el veredicto «bad» baja y el
 * resumen (que hablaba de ellos) se quita.
 */
export function groundReview<T extends { verdict: SimulationVerdict; summary: string; findings: SimulationFinding[] }>(review: T, agentTexts: string[]): T {
  const said = plain(agentTexts.join(" \n "));
  const findings = review.findings.filter((f) => {
    if (!f.quote || f.kind === "good") return true;
    const q = plain(f.quote.replace(/[…]+$/u, ""));
    // Basta con que el comienzo de la cita esté: el revisor suele recortarla.
    return !q || said.includes(q.slice(0, 60));
  });
  if (findings.length === review.findings.length) return review;
  const stillBad = findings.some((f) => f.kind === "invented");
  const verdict: SimulationVerdict =
    review.verdict === "bad" && !stillBad ? (findings.some((f) => f.kind !== "good") ? "review" : "ok") : review.verdict;
  return { ...review, verdict, findings, summary: verdict === review.verdict ? review.summary : "" };
}
