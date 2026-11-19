import { cleanReplyOptions } from "@crm/shared";

/**
 * Los botones de una respuesta del agente. El agente escribe su mensaje como
 * siempre y, si su agente tiene «Responder con botones», este paso corto mira
 * si termina en una pregunta que el cliente responde eligiendo y saca las
 * opciones. Se probó a que el agente llamara él mismo a una herramienta de
 * «responder con botones»: con instrucciones largas o cortas, gpt-4.1-mini y
 * gpt-4o-mini contestaban siempre con texto. Sacarlas después es fiable y barato.
 */

export const REPLY_OPTIONS_SYSTEM = [
  "Lees la respuesta que un negocio va a enviar a un cliente por WhatsApp y decides si lleva botones para pulsar.",
  "Lleva botones solo si el mensaje termina con una pregunta que el cliente responde eligiendo:",
  "- entre pocas opciones que el mensaje nombra («¿transferencia o Yape?», «¿mañana o tarde?», «¿cuál de los dos cursos?»): una opción por cada una;",
  "- de sí o no («¿te separo un cupo?», «¿te envío los datos de pago?»): dos opciones, la afirmativa con la acción («Sí, sepárame», «Sí, envíalos») y una negativa amable («Todavía no», «Tengo dudas»).",
  "Si al final hay dos preguntas seguidas, usa una opción para cada camino (por ejemplo «Sí, envíalos» y «Otra información»).",
  "Sin botones si la pregunta es abierta (qué busca, cuéntame más), si pide un dato que hay que escribir (nombre, correo, dirección, fecha exacta) o si no termina en pregunta.",
  "Cada opción: de 1 a 3 palabras y como mucho 20 caracteres («Inscribirme» mejor que «Datos para inscripción», «Más detalles», «Sí, sepárame»), en el idioma del mensaje, empezando con mayúscula, sin emojis ni numeración. De 2 a 10 opciones.",
  'Responde solo con JSON: {"options": ["…", "…"]} o {"options": []}.',
].join("\n");

/** Solo mira las respuestas que terminan en pregunta: el resto no lleva botones y no se gasta la llamada. */
export function endsWithQuestion(reply: string): boolean {
  return /\?[\s\p{Emoji_Presentation}\p{Extended_Pictographic}"»)]*$/u.test(reply.trim()) || /\?[^?]{0,60}$/u.test(reply.trim());
}

/** Las opciones del JSON del modelo, limpias; [] si no hay o no se entiende. */
export function parseReplyOptions(raw: string): string[] {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]) as { options?: unknown };
    return cleanReplyOptions(parsed.options);
  } catch {
    return [];
  }
}
