/**
 * Botones en la respuesta del agente. El agente responde con la herramienta
 * reply_with_buttons (su mensaje y las opciones) y aquí se decide cómo salen:
 * hasta 3 opciones cortas, como botones; más, o alguna que no cabe, como una
 * lista de WhatsApp. Instagram y Messenger los reciben como respuestas rápidas
 * y TikTok como opciones numeradas: eso ya lo resuelve el envío de cada canal.
 *
 * Al pulsar, el cliente «escribe» el texto de la opción, así que el agente lo
 * entiende sin nada más.
 */

export const REPLY_BUTTONS_TOOL = "reply_with_buttons";
export const REPLY_OPTIONS_MAX = 10;
/** Lo que admite Meta: 20 caracteres por botón, 24 por opción de lista, 3 botones. */
export const BUTTON_TITLE_MAX = 20;
export const LIST_TITLE_MAX = 24;
const LIST_DESCRIPTION_MAX = 72;
const BUTTONS_MAX = 3;
/** El botón que abre la lista. */
export const LIST_OPEN_LABEL = "Ver opciones";

/** Las opciones limpias: sin vacías ni repetidas y como mucho 10. Con menos de 2 no hay botones. */
export function cleanReplyOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const t = r.replace(/\s+/g, " ").trim();
    const key = t.toLocaleLowerCase("es");
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length === REPLY_OPTIONS_MAX) break;
  }
  return out.length >= 2 ? out : [];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface ReplyInteractive {
  buttons: { id: string; title: string }[];
  list?: { button: string; rows: { id: string; title: string; description?: string }[] };
}

/** ¿Van como botones? Hasta 3 opciones de hasta 20 caracteres; si no, lista. */
export function optionsAsButtons(options: string[]): boolean {
  return options.length <= BUTTONS_MAX && options.every((o) => o.length <= BUTTON_TITLE_MAX);
}

/**
 * Lo que se envía: botones o lista. Una opción que no cabe en la lista se
 * recorta en el título y va entera en la descripción.
 */
export function interactiveFromOptions(options: string[]): ReplyInteractive {
  const opts = cleanReplyOptions(options);
  if (optionsAsButtons(opts)) return { buttons: opts.map((title, i) => ({ id: `opt_${i + 1}`, title })) };
  return {
    buttons: [],
    list: {
      button: LIST_OPEN_LABEL,
      rows: opts.map((o, i) => ({
        id: `opt_${i + 1}`,
        title: clip(o, LIST_TITLE_MAX),
        ...(o.length > LIST_TITLE_MAX ? { description: clip(o, LIST_DESCRIPTION_MAX) } : {}),
      })),
    },
  };
}

/** Las opciones como las lee la IA en el historial, para saber qué ofreció: «[Botones: Sí · Tengo dudas]». */
export function optionsNote(options: string[]): string {
  return options.length ? `[Botones: ${options.join(" · ")}]` : "";
}
