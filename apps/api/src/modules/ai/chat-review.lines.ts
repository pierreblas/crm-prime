import { REPLY_BUTTONS_TOOL, type SimulationReviewLine } from "@crm/shared";
import { MediaUnderstandingService } from "./media-understanding.service";
import { traceToolCall } from "./playground-trace";

/**
 * Una conversación real como la lee el revisor: lo que dijo el cliente, lo que
 * respondió la IA (con lo que consultó en cada respuesta, para saber si un dato
 * salió de ahí) y, de contexto (no se juzga), lo que dijo una persona del equipo
 * y lo automático.
 *
 * Solo se juzga lo que escribió el agente con su ejecución enlazada (aiRunId):
 * sin ella no se sabe qué consultó y cualquier dato parecería inventado. Los
 * flujos, los avisos programados y los mensajes anteriores al enlace también
 * se guardan como de la IA: van como «automático».
 */

/** Los mensajes que entran, como mucho: los últimos de la conversación. */
export const CHAT_REVIEW_MESSAGES = 30;

export interface ReviewMessage {
  direction: string;
  author: string | null;
  type: string;
  content: string | null;
  transcript?: string | null;
  note?: string | null;
  aiRunId: string | null;
  interactive: unknown;
}

export interface ReviewRun {
  status: string;
  escalationReason: string | null;
  toolCalls: { toolName: string; input: unknown; output: unknown }[];
}

/** El texto de lo que devolvió una herramienta, como lo guarda AiToolCall.output ({ result }). */
function outputText(output: unknown): string {
  if (output && typeof output === "object" && "result" in output) return String((output as { result: unknown }).result ?? "");
  return output == null ? "" : JSON.stringify(output);
}

/** Las opciones de un mensaje con botones o lista (lo guardado en Message.interactive). */
function offered(raw: unknown): string[] {
  const buttons = raw && typeof raw === "object" ? (raw as { buttons?: unknown }).buttons : null;
  if (!Array.isArray(buttons)) return [];
  return buttons.map((b) => (b && typeof b === "object" ? String((b as { title?: unknown }).title ?? "") : "")).filter(Boolean);
}

/** Lo que consultó la IA en una respuesta: «search_products «x» → Encontró 1… Devolvió: {…}». */
function consulted(run: ReviewRun | undefined): string[] {
  if (!run) return [];
  return run.toolCalls
    .filter((c) => c.toolName !== REPLY_BUTTONS_TOOL)
    .map((c) => {
      const t = traceToolCall(c.toolName, (c.input ?? {}) as Record<string, unknown>, outputText(c.output));
      return `${c.toolName}${t.input ? ` ${t.input}` : ""} → ${t.summary}${t.evidence ? `\nDevolvió: ${t.evidence}` : ""}`.slice(0, 2000);
    })
    .slice(0, 12);
}

/**
 * Las líneas para el revisor. Una respuesta de la IA partida en varios mensajes
 * (mismo aiRunId, seguidos) va como una sola, con sus consultas una vez.
 */
export function chatReviewLines(messages: ReviewMessage[], runs: Map<string, ReviewRun>): SimulationReviewLine[] {
  const lines: SimulationReviewLine[] = [];
  let lastRun: string | null | undefined;
  for (const m of messages) {
    const text = MediaUnderstandingService.historyTextOf(m).trim();
    if (!text) continue;
    if (m.direction === "INBOUND") {
      lines.push({ who: "customer", text: text.slice(0, 4000), consulted: [], options: [], handoff: null });
      lastRun = undefined;
      continue;
    }
    if (m.author !== "AI") {
      lines.push({ who: "team", text: text.slice(0, 4000), consulted: [], options: [], handoff: null });
      lastRun = undefined;
      continue;
    }
    if (!m.aiRunId) {
      lines.push({ who: "auto", text: text.slice(0, 4000), consulted: [], options: offered(m.interactive), handoff: null });
      lastRun = undefined;
      continue;
    }
    const prev = lines[lines.length - 1];
    const options = offered(m.interactive);
    if (prev?.who === "agent" && lastRun === m.aiRunId) {
      prev.text = `${prev.text}\n\n${text}`.slice(0, 4000);
      if (options.length) prev.options = options;
      continue;
    }
    const run = runs.get(m.aiRunId);
    lines.push({
      who: "agent",
      text: text.slice(0, 4000),
      consulted: consulted(run),
      options,
      handoff: run?.status === "ESCALATED" ? run.escalationReason ?? "sin motivo" : null,
    });
    lastRun = m.aiRunId;
  }
  return lines;
}
