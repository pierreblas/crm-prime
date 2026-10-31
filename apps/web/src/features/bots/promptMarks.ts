/**
 * Qué hay dentro de «Cómo debe atender», para señalarlo en la ventana grande:
 *
 *  - marcadores por rellenar, como [HORARIO] o [NOMBRE DEL NEGOCIO] (los deja
 *    el asistente donde no sabía el dato);
 *  - acciones del agente nombradas en el texto (search_products…), y si están
 *    activadas o no;
 *  - secciones: líneas en MAYÚSCULAS o que empiezan por «#», para moverse por
 *    un texto largo;
 *  - variables del contacto ({{nombre}}…), y si existen: una que no existe no
 *    se reemplaza y el cliente vería las llaves.
 *
 * Sin React ni DOM: solo posiciones en el texto, para poder probarlo solo.
 */

export interface PromptTool {
  name: string;
  title: string;
  enabled: boolean;
}

export type MarkKind = "pending" | "tool" | "tool-off" | "var" | "var-off" | "head" | "flash";

/** Una variable del contacto que se reemplaza en las instrucciones. */
export interface PromptVar {
  key: string;
  label: string;
}

/** Las que existen siempre (las rellena el servidor al responder). */
export const BUILTIN_VARS: PromptVar[] = [
  { key: "nombre", label: "Nombre" },
  { key: "telefono", label: "Teléfono" },
  { key: "pais", label: "País" },
  { key: "moneda", label: "Moneda" },
];

/**
 * Lo que trae cada producto al consultarlo con search_products, además de
 * sus campos propios. El precio llega en la moneda del cliente si el
 * producto la tiene.
 */
export const PRODUCT_BASE_FIELDS: { label: string; hint: string }[] = [
  { label: "Nombre", hint: "El nombre del producto." },
  { label: "Precio", hint: "En la moneda del cliente si el producto la tiene; si no, en la suya." },
  { label: "Descripción", hint: "La descripción del producto." },
  { label: "SKU", hint: "El código del producto, si tiene." },
];

export interface Mark {
  start: number;
  end: number;
  kind: MarkKind;
  /** Lo marcado tal cual (sin corchetes en los marcadores). */
  text: string;
}

const PENDING_RE = /\[([A-ZÁÉÍÓÚÑÜ0-9][A-ZÁÉÍÓÚÑÜ0-9 _\-/.,:]{1,59})\]/g;
// Una línea en mayúsculas (al menos tres letras, ninguna minúscula), corta;
// admite una aclaración entre paréntesis al final: «PITCH (la primera vez)».
const CAPS_LINE_RE = /^[A-ZÁÉÍÓÚÑÜ0-9][A-ZÁÉÍÓÚÑÜ0-9 \-:/¿?¡!.,'«»]{2,79}(\s*\([^()\n]{1,60}\))?:?$/;

/** Marcadores entre corchetes que faltan por rellenar, en orden de aparición. */
export function findPending(text: string): Mark[] {
  const out: Mark[] = [];
  for (const m of text.matchAll(PENDING_RE)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, kind: "pending", text: m[1]! });
  }
  return out;
}

/** Títulos de sección: líneas en MAYÚSCULAS o que empiezan por «#». */
export function findHeadings(text: string): Mark[] {
  const out: Mark[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (line.startsWith("#")) {
      const title = line.replace(/^#+\s*/, "").trim();
      if (title) out.push({ start: offset + lead, end: offset + lead + line.length, kind: "head", text: title });
    } else if (CAPS_LINE_RE.test(line) && (line.replace(/\(.*\)$/, "").match(/[A-ZÁÉÍÓÚÑÜ]/g) ?? []).length >= 3 && !PENDING_RE.test(line)) {
      out.push({ start: offset + lead, end: offset + lead + line.length, kind: "head", text: line.replace(/:$/, "") });
    }
    PENDING_RE.lastIndex = 0;
    offset += raw.length + 1;
  }
  return out;
}

const VAR_RE = /\{\{\s*([^{}\n]{1,40}?)\s*\}\}/g;

/**
 * Variables {{…}} del texto. Existen si coinciden (sin mayúsculas) con la clave
 * o el nombre de una variable, igual que al reemplazarlas en el servidor.
 */
export function findVars(text: string, vars: PromptVar[]): Mark[] {
  const known = new Set(vars.flatMap((v) => [v.key.toLowerCase(), v.label.toLowerCase()]));
  const out: Mark[] = [];
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1]!.trim();
    out.push({ start: m.index!, end: m.index! + m[0].length, kind: known.has(name.toLowerCase()) ? "var" : "var-off", text: name });
  }
  return out;
}

/** Acciones del agente nombradas en el texto, activadas o no. */
export function findTools(text: string, tools: PromptTool[]): Mark[] {
  const out: Mark[] = [];
  for (const t of tools) {
    const re = new RegExp(`(?<![A-Za-z0-9_])${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g");
    for (const m of text.matchAll(re)) {
      out.push({ start: m.index!, end: m.index! + m[0].length, kind: t.enabled ? "tool" : "tool-off", text: t.name });
    }
  }
  return out;
}

/**
 * Todas las marcas, ordenadas y sin solaparse. Si dos chocan gana la más
 * concreta: marcador > acción > título.
 */
export function collectMarks(text: string, tools: PromptTool[], vars: PromptVar[] = BUILTIN_VARS): Mark[] {
  const rank: Record<MarkKind, number> = { flash: -1, pending: 0, tool: 1, "tool-off": 1, var: 1, "var-off": 1, head: 2 };
  const all = [...findPending(text), ...findTools(text, tools), ...findVars(text, vars), ...findHeadings(text)].sort(
    (a, b) => a.start - b.start || rank[a.kind] - rank[b.kind] || a.end - b.end,
  );
  const out: Mark[] = [];
  for (const m of all) {
    const last = out[out.length - 1];
    if (last && m.start < last.end) {
      // Choque: se queda la de más rango; si la nueva gana, sustituye a la anterior.
      if (rank[m.kind] < rank[last.kind]) out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }
  return out;
}

/** El texto troceado en tramos: los marcados llevan su marca. */
export function segments(text: string, marks: Mark[]): { text: string; mark?: Mark }[] {
  const out: { text: string; mark?: Mark }[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start) });
    out.push({ text: text.slice(m.start, m.end), mark: m });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** Marcadores distintos con cuántas veces aparecen y dónde está el primero. */
export function pendingSummary(marks: Mark[]): { text: string; count: number; first: Mark }[] {
  const by = new Map<string, { text: string; count: number; first: Mark }>();
  for (const m of marks) {
    if (m.kind !== "pending") continue;
    const hit = by.get(m.text);
    if (hit) hit.count++;
    else by.set(m.text, { text: m.text, count: 1, first: m });
  }
  return [...by.values()];
}
