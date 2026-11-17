import { contactCurrency, countryFromPhone } from "./money.js";
import { isDialable } from "./phone.js";

/**
 * Variables del contacto en los textos del agente: «Hola {{nombre}}».
 *
 * Dos usos, con reglas distintas cuando falta el dato:
 *
 *  - Lo que lee el cliente (saludo, fuera de horario, respuestas por palabra
 *    clave, aviso al pasar el chat): la variable se quita y la frase se
 *    arregla. «Hola {{nombre}}, gracias» llega como «Hola, gracias». Al
 *    cliente nunca le llegan llaves.
 *  - Las instrucciones del agente (las lee la IA): queda «(sin dato)», para
 *    que la IA sepa que no lo tiene y no se lo invente.
 *
 * `{{nombre|amigo}}`: lo que va tras la barra se usa si falta el dato.
 * Una variable se reconoce por la clave o por el nombre del campo, sin mirar
 * mayúsculas ni tildes: {{País}}, {{pais}} y {{PAIS}} son la misma.
 */

export interface ContactVarDef {
  key: string;
  label: string;
}

/** Las que existen siempre: salen del propio contacto. */
export const BUILTIN_CONTACT_VARS: ContactVarDef[] = [
  { key: "nombre", label: "Nombre" },
  { key: "telefono", label: "Teléfono" },
  { key: "pais", label: "País" },
  { key: "moneda", label: "Moneda" },
];

/** Una variable en el texto. El grupo 1 es lo de dentro: «nombre» o «nombre|amigo». */
export const CONTACT_VAR_RE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;

/** Lo que va entre llaves cuando falta un dato y se lo dice a la IA. */
export const MISSING_FOR_AI = "(sin dato)";

/** Cómo se compara el nombre de una variable: sin mayúsculas, tildes ni espacios sobrantes. */
export function varKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** «nombre|amigo» → nombre y lo que se pone si falta. */
export function parseVar(inner: string): { name: string; fallback: string } {
  const bar = inner.indexOf("|");
  if (bar < 0) return { name: inner.trim(), fallback: "" };
  return { name: inner.slice(0, bar).trim(), fallback: inner.slice(bar + 1).trim() };
}

/** Los valores de un contacto, por nombre de variable ya pasado por `varKey`. */
export type ContactVarValues = Record<string, string>;

/**
 * Los valores de las variables para un contacto: las de siempre y sus campos
 * personalizados (guardados en `metadata`). Un campo con valor manda sobre
 * una de siempre con la misma clave; uno vacío no la borra.
 */
export function contactVarValues(
  contact: { name: string | null; phone: string; currency?: string | null; metadata?: unknown },
  fields: ContactVarDef[] = [],
): ContactVarValues {
  const name = (contact.name ?? "").trim();
  const out: ContactVarValues = {
    // Sin nombre, a veces se guarda el número: eso no es un nombre para saludar.
    nombre: /^[+\d\s().-]+$/.test(name) ? "" : name,
    // Un cliente de Messenger, Instagram o TikTok (o de WhatsApp sin número) no tiene teléfono que dar.
    telefono: isDialable(contact.phone) ? contact.phone : "",
    pais: countryFromPhone(contact.phone)?.name ?? "",
    moneda: contactCurrency(contact) ?? "",
  };
  const meta = contact.metadata && typeof contact.metadata === "object" ? (contact.metadata as Record<string, unknown>) : {};
  for (const f of fields) {
    const value = valueText(meta[f.key]);
    for (const k of [varKey(f.key), varKey(f.label)]) {
      if (value || !(k in out)) out[k] = value;
    }
  }
  return out;
}

function valueText(raw: unknown): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.map(valueText).filter(Boolean).join(", ");
  if (typeof raw === "object") return "";
  return String(raw).trim();
}

/** Las variables que usa un texto (por su nombre tal cual), sin repetir. */
export function varsIn(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(CONTACT_VAR_RE)) {
    const { name } = parseVar(m[1]!);
    if (name && !out.some((n) => varKey(n) === varKey(name))) out.push(name);
  }
  return out;
}

// Marca de un hueco mientras se arregla la frase. Postgres no guarda este
// carácter en un texto, así que no puede venir en un dato del contacto.
const GAP = "\u0000";

/**
 * Rellena un mensaje que va a leer el cliente. Si falta un dato (y no hay
 * nada tras la barra), la variable se quita y la frase se arregla.
 */
export function fillContactText(text: string, values: ContactVarValues): string {
  const raw = text.replace(CONTACT_VAR_RE, (_m, inner: string) => {
    const { name, fallback } = parseVar(inner);
    return values[varKey(name)] || fallback || GAP;
  });
  return raw.includes(GAP) ? closeGaps(raw) : raw;
}

/** Rellena las instrucciones del agente: si falta un dato, «(sin dato)». */
export function fillInstructions(text: string, values: ContactVarValues): string {
  return text.replace(CONTACT_VAR_RE, (_m, inner: string) => {
    const { name, fallback } = parseVar(inner);
    return values[varKey(name)] || fallback || MISSING_FOR_AI;
  });
}

const OPENS = /[¡¿(«"“]$/;
const CLOSES = /^[,.;:!?…)»"”]/;

/**
 * Quita los huecos de las variables sin dato y deja la frase bien:
 *
 *   «Hola {{nombre}}, gracias»   → «Hola, gracias»
 *   «¡Hola, {{nombre}}!»         → «¡Hola!»
 *   «{{nombre}}, gracias por…»   → «Gracias por…»
 *   «Gracias, {{nombre}}»        → «Gracias»
 *   «Hola {{nombre}} 👋»          → «Hola 👋»
 *   una línea que solo tenía la variable desaparece (no deja una línea en
 *   blanco, que con «varios mensajes cortos» partiría el mensaje).
 */
function closeGaps(s: string): string {
  let out = s;
  for (let i = out.indexOf(GAP); i !== -1; i = out.indexOf(GAP)) {
    // El hueco con los espacios de alrededor y otros huecos pegados («{{nombre}} {{apellido}}»).
    let a = i;
    while (a > 0 && (out[a - 1] === " " || out[a - 1] === "\t")) a--;
    let b = i + 1;
    while (b < out.length && (out[b] === " " || out[b] === "\t" || out[b] === GAP)) b++;
    let left = out.slice(0, a);
    let right = out.slice(b);
    const lineStart = left === "" || left.endsWith("\n");
    const lineEnd = right === "" || /^\r?\n/.test(right);

    if (lineStart && lineEnd) {
      if (right) right = right.replace(/^\r?\n/, "");
      else left = left.replace(/\r?\n$/, "");
      out = left + right;
      continue;
    }
    if (CLOSES.test(right)) {
      // Ya sigue un signo: sobra la coma de antes.
      left = left.replace(/,$/, "");
      // Al empezar la frase no puede quedar «, gracias».
      if (lineStart || OPENS.test(left)) right = right.replace(/^[,;:]\s*/, "");
    } else if (lineEnd) {
      left = left.replace(/,$/, "");
    } else if (!lineStart && !OPENS.test(left)) {
      right = ` ${right}`;
    }
    // Si lo quitado abría la frase, la frase sigue empezando en mayúscula.
    if (lineStart || /[.!?¡¿]$/.test(left)) right = right.replace(/^(\s*)(\p{Ll})/u, (_m, sp: string, c: string) => sp + c.toUpperCase());
    out = left + right;
  }
  return out;
}
