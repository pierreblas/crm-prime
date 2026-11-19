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
  "Si te pasan «Reglas del negocio sobre botones», mandan sobre todo lo demás: si la pregunta del mensaje encaja con una regla, usa exactamente los textos que indica, sin cambiarlos ni acortarlos y en el mismo orden; si una regla dice que en ese caso no haya botones, devuelve []. Si ninguna encaja, sigue las indicaciones de abajo.",
  "Lleva botones solo si el mensaje termina con una pregunta que el cliente responde eligiendo:",
  "- entre pocas opciones que el mensaje nombra («¿transferencia o Yape?», «¿mañana o tarde?», «¿cuál de los dos cursos?»): una opción por cada una;",
  "- de sí o no («¿te separo un cupo?», «¿te envío los datos de pago?»): dos opciones, la afirmativa con la acción («Sí, sepárame», «Sí, envíalos») y una negativa amable («Todavía no», «Tengo dudas»).",
  "Si al final hay dos preguntas seguidas, usa una opción para cada camino (por ejemplo «Sí, envíalos» y «Otra información»).",
  "Sin botones si la pregunta es abierta (qué busca, cuéntame más), si pide un dato que hay que escribir (nombre, correo, dirección, fecha exacta) o si no termina en pregunta.",
  "Cada opción: de 1 a 3 palabras y como mucho 20 caracteres («Inscribirme» mejor que «Datos para inscripción», «Más detalles», «Sí, sepárame»), en el idioma del mensaje, empezando con mayúscula, sin emojis ni numeración. De 2 a 10 opciones.",
  'Responde solo con JSON: {"options": ["…", "…"]} o {"options": []}.',
].join("\n");

/** Como mucho, cuántas reglas sobre botones se toman de las instrucciones, y su largo. */
const RULES_MAX = 12;
const RULE_CHARS = 300;

/**
 * Las frases de las instrucciones del agente que hablan de botones («Cuando le
 * preguntes si quiere separar su cupo, usa los botones "Sí, sepárame" y "Tengo
 * dudas"», «Nunca uses botones al pedir el correo»). Así quien configura el
 * agente decide qué botones salen y cuándo no, con sus palabras. Una línea
 * larga se parte en frases y solo quedan las que nombran botones.
 */
export function buttonRules(instructions: string | null | undefined): string[] {
  if (!instructions) return [];
  const mentions = (t: string) => /\bbot[oó]n(es)?\b/iu.test(t);
  const out: string[] = [];
  for (const raw of instructions.split(/\n+/)) {
    const line = raw.replace(/^[\s>*\-•·\d.)]+/u, "").trim();
    if (!line || !mentions(line)) continue;
    const pieces = line.length > RULE_CHARS ? line.split(/(?<=[.!?])\s+/u).filter(mentions) : [line];
    for (const p of pieces) {
      const rule = p.trim().slice(0, RULE_CHARS);
      if (rule && !out.includes(rule)) out.push(rule);
      if (out.length === RULES_MAX) return out;
    }
  }
  return out;
}

/** Lo que lee el paso de los botones: las reglas del negocio (si hay) y el mensaje. */
export function replyOptionsInput(reply: string, rules: string[]): string {
  const message = reply.slice(-1200);
  if (!rules.length) return message;
  return `## Reglas del negocio sobre botones\n${rules.map((r) => `- ${r}`).join("\n")}\n\n## Mensaje\n${message}`;
}

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
