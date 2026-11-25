import { PAYMENT_METHODS_TOOL } from "@crm/shared";

/**
 * Lo que escribe el agente, revisado antes de que salga. Un modelo tiene que
 * contestar algo aunque no le quede nada que decir: tras mandar un brochure
 * repetía su texto, se quedaba en blanco (y el chat pasaba a una persona) o
 * escribía una nota para sí mismo, y a un cliente le llegó «(Esta respuesta está
 * duplicada y no debería aparecer.)». Aquí se le da forma de no escribir y se
 * corta lo que no es un mensaje.
 */

/** Acciones que ya le mandan algo al cliente: después puede no quedar nada que decir. */
export const SENDING_TOOLS: ReadonlySet<string> = new Set(["send_product_image", "send_product_file", PAYMENT_METHODS_TOOL]);

/** Lo que responde el modelo cuando ya está todo dicho con lo que mandó. No se envía nunca. */
export const NO_REPLY = "[SIN_MENSAJE]";
const NO_REPLY_MARK = /\[?\bsin[_ ]mensaje\b\]?\.?/i;

export const REPLY_RULE =
  "\n\nTodo lo que escribas le llega tal cual al cliente: nunca escribas notas, aclaraciones sobre tu propia respuesta ni comentarios entre paréntesis para ti o para el equipo.";

/** Solo si sus acciones salen de verdad: en copiloto hace falta un texto que aprobar. */
export const NO_REPLY_RULE = `\n\nCuando mandes un archivo, una foto o los métodos de pago, su texto ya le llegó al cliente: no lo escribas otra vez. Después da el siguiente paso que pidan tus instrucciones. Solo si no piden nada más o piden no escribir más, responde únicamente ${NO_REPLY}: no se le envía nada.`;

/** Lo que se le dice, una vez, cuando lo que escribió no es un mensaje. */
export function retryNote(sent: boolean): string {
  return `(Aviso del sistema: lo que escribiste no es un mensaje para el cliente y no se le envió. Escribe solo el mensaje que debe leer, sin hablar de tu respuesta${sent ? `; si ya está todo dicho con lo que le mandaste, responde únicamente ${NO_REPLY}` : ""}.)`;
}

/** El resultado de una acción repetida: no se hace dos veces. */
export function repeatedAction(output: string): string {
  return `Eso ya lo hiciste en este turno y no se repite. Su resultado fue: ${output}`;
}

export type CheckedReply = { kind: "text"; text: string } | { kind: "silent" } | { kind: "note" };

// Habla de su propia respuesta: nadie se lo diría a un cliente.
const ABOUT_ITSELF =
  /\besta respuesta\b[^.\n]{0,60}\b(duplicad|repetid|redundante|omitid|no (deber[ií]a|debe) (aparecer|mostrarse|enviarse|llegar|salir|verse))|\beste (mensaje|texto)\b[^.\n]{0,40}\b(est[aá] duplicado|es un duplicado|no (deber[ií]a|debe) (aparecer|mostrarse|enviarse|salir|verse))/i;
const LABEL = /^\W*(nota (interna|del sistema|para el (equipo|asesor|agente|operador))|mensaje interno|uso interno)\b/i;
const NOT_FOR_CUSTOMER = /\bno (lo |la |se )?(enviar|env[ií]es|mandar|mandes|mostrar|muestres)( esto| este mensaje)? al (cliente|usuario|contacto)\b/i;

const CLOSER: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Entero entre paréntesis o corchetes: el primero se cierra justo al final. */
function wrapped(raw: string): boolean {
  const t = raw.replace(/^[\s*_~]+|[\s*_~.]+$/g, "");
  const close = CLOSER[t[0] ?? ""];
  if (!close || t.length < 2) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === t[0]) depth++;
    else if (t[i] === close && --depth === 0) return i === t.length - 1;
  }
  return false;
}

const isNote = (line: string) => ABOUT_ITSELF.test(line) || LABEL.test(line) || (wrapped(line) && NOT_FOR_CUSTOMER.test(line));

/** Sin tildes, signos, emojis ni formato: para saber si dos textos dicen lo mismo. */
const bare = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Quita el texto del archivo si el mensaje empieza repitiéndolo, o es solo eso. */
function withoutCaptions(text: string, captions: string[]): string {
  let out = text;
  for (const caption of captions.map(bare).filter(Boolean)) {
    if (bare(out) === caption) return "";
    const first = /^(.+?)(?:[.!:;]+\s+|\s+[—–-]\s+|\n+)/s.exec(out);
    if (first && bare(first[1]!) === caption) out = out.slice(first[0].length).trim();
  }
  return out;
}

/**
 * Qué se hace con lo que escribió el modelo. `sent`: los textos de lo que ya le
 * mandó al cliente en este turno (vacío si fue sin texto), o null si no le mandó
 * nada. «silent»: no hay nada que decir. «note»: no es un mensaje para el cliente.
 */
export function checkReply(raw: string, sent: string[] | null): CheckedReply {
  const marked = NO_REPLY_MARK.test(raw);
  const clean = raw.replace(new RegExp(NO_REPLY_MARK.source, "gi"), "").trim();
  if (!clean) return sent ? { kind: "silent" } : { kind: "note" };
  if (wrapped(clean)) return sent && marked ? { kind: "silent" } : { kind: "note" };

  const lines = clean.split("\n");
  const kept = lines.filter((l) => !isNote(l));
  const said = kept.length === lines.length ? clean : kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!said) return { kind: "note" };

  const text = sent ? withoutCaptions(said, sent) : said;
  return text ? { kind: "text", text } : { kind: "silent" };
}
