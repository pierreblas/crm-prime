import type { LlmMessage } from "./llm.types";

/** Cuántos mensajes de antes lee el agente. */
export const HISTORY_MAX = 40;

const SENT_FIRST = "(El cliente todavía no había escrito. Lo que sigue se lo envió la empresa antes de su primer mensaje.)";

/**
 * El historial listo para el modelo, que exige empezar por el cliente. Lo que
 * la empresa mandó antes de que escribiera (la bienvenida de un formulario, una
 * difusión, un flujo) se conserva: antes se borraba y el agente volvía a
 * presentar lo que el cliente acababa de recibir. Si el historial viene
 * recortado, lo primero no es el principio y sí se puede quitar.
 */
export function openHistory(messages: LlmMessage[], truncated: boolean): { messages: LlmMessage[]; sentFirst: boolean } {
  const list = [...messages];
  if (truncated) while (list.length && list[0]!.role === "assistant") list.shift();
  if (!list.length) return { messages: [{ role: "user", content: "(el contacto inició la conversación)" }], sentFirst: false };
  if (list[0]!.role !== "assistant") return { messages: list, sentFirst: false };
  return { messages: [{ role: "user", content: SENT_FIRST }, ...list], sentFirst: true };
}

/**
 * Si lo último que recibió el cliente antes de escribir fue automático: una
 * plantilla, o una tanda que no redactó el agente ni una persona (un flujo, el
 * saludo, una respuesta por palabra clave). Se mira la tanda entera porque la
 * foto o el archivo que manda el agente no llevan su ejecución: su texto sí.
 */
export function repliedToAutomatic(rows: { direction: string; author: string; templateId: string | null; aiRunId: string | null }[]): boolean {
  let i = rows.length - 1;
  while (i >= 0 && rows[i]!.direction === "INBOUND") i--;
  const last = i >= 0 ? rows[i]! : null;
  // Sin una respuesta del cliente detrás, todavía no contestó a nada.
  if (!last || i === rows.length - 1) return false;
  if (last.templateId) return true;
  for (; i >= 0 && rows[i]!.direction === "OUTBOUND"; i--) {
    if (rows[i]!.author !== "AI" || rows[i]!.aiRunId) return false;
  }
  return true;
}

/** Para que no presente otra vez lo que el cliente ya recibió. */
export const AUTO_SENT_RULE =
  "\n\n## Ya se le envió\nA este cliente se le mandó un mensaje automático (una bienvenida, una difusión o un flujo) que ves en el historial como si fuera tuyo: cuenta como dicho por ti. No repitas su saludo, su presentación ni los datos que ya trae (precio, fechas, qué incluye), aunque tus instrucciones pidan presentarlo así, y no te presentes otra vez: responde a lo que dice el cliente y da el siguiente paso. Si te pregunta un dato, contéstalo aunque ya estuviera, en corto y solo ese.";
