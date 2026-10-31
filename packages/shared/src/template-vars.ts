/**
 * Variables de las plantillas de WhatsApp. Meta admite dos formatos:
 * posicional (`{{1}}`, `{{2}}`) y con nombre (`{{nombre}}`, `{{fecha_cita}}`,
 * el que propone hoy el Administrador de WhatsApp). Al enviar, una plantilla
 * con nombre exige `parameter_name` en cada valor; sin él, Meta la rechaza.
 */

const NAMED = /\{\{([a-z_][a-z0-9_]*)\}\}/g;
const POSITIONAL = /\{\{(\d+)\}\}/g;

/** Los nombres de las variables con nombre, en orden de aparición y sin repetir. */
export function namedTemplateVars(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(NAMED)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Sustituye `{{1}}` por `values[0]` y `{{nombre}}` por el valor de su posición en `names`. */
export function fillTemplateText(text: string, values: string[], names: string[] = []): string {
  return text
    .replace(POSITIONAL, (m, n: string) => values[Number(n) - 1] ?? m)
    .replace(NAMED, (m, name: string) => {
      const i = names.indexOf(name);
      return i >= 0 ? (values[i] ?? m) : m;
    });
}

/**
 * Un valor tal como lo acepta Meta: sin saltos de línea ni tabulaciones, sin
 * más de cuatro espacios seguidos y nunca vacío (un parámetro vacío hace
 * fallar el envío entero).
 */
export function cleanTemplateParam(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
  return clean || fallback;
}

/** Cuántas variables tiene un texto de plantilla, en cualquiera de los dos formatos. */
export function templateVarCount(text: string | null | undefined): number {
  const named = namedTemplateVars(text).length;
  if (named) return named;
  const indexes = [...(text ?? "").matchAll(POSITIONAL)].map((m) => Number(m[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}
