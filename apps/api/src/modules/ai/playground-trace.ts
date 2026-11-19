import { REPLY_BUTTONS_TOOL, optionsAsButtons, type PlaygroundToolCall } from "@crm/shared";

/**
 * Lo que consultó el agente («Probar conversación» y «¿Por qué?» de la bandeja), en una línea por consulta:
 * con qué buscó y qué le devolvió. Sin esto solo se veía «herramientas:
 * search_products» y no había forma de saber si encontró el curso, si listó el
 * catálogo entero o si al producto le faltaban datos que luego se inventó.
 */

const MAX_INPUT = 160;
const MAX_SUMMARY = 240;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Los argumentos de la llamada, legibles: un solo texto (la búsqueda, el motivo, la etapa) tal cual; el resto, en JSON corto. */
function inputText(input: Record<string, unknown> | undefined): string {
  if (!input || !Object.keys(input).length) return "";
  const values = Object.values(input);
  if (values.length === 1 && typeof values[0] === "string") return clip(`«${values[0]}»`, MAX_INPUT);
  return clip(JSON.stringify(input), MAX_INPUT);
}

/**
 * La búsqueda automática en el conocimiento (la que se hace antes de responder,
 * sin que el modelo la pida) contada como una consulta más, con lo que trajo.
 */
export function knowledgeCall(query: string, chunks: string[]): { input: Record<string, unknown>; output: string } {
  return {
    input: { query: query.slice(0, 300) },
    output: JSON.stringify(chunks.map((content) => ({ content: content.slice(0, 500) }))),
  };
}

function parse(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

const quoted = (l: string[]) => l.map((x) => `«${x}»`).join(", ");

/** Los datos que pidió el cliente al buscar en el catálogo (el «asks» de search_products). */
function asksOf(input: Record<string, unknown> | undefined): string[] {
  const a = input?.asks;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && !!x) : [];
}

function products(output: string, asks: string[] = []): string {
  const r = parse(output) as {
    total?: number;
    note?: string;
    products?: { name: string; missingDetails?: string[] }[];
    otherNames?: string[];
  } | null;
  if (!r || !Array.isArray(r.products)) return clip(output, MAX_SUMMARY);
  if (!r.total) return "El catálogo está vacío.";
  const names = r.products.map((p) => p.name);
  const listed = /se lista el catálogo|Catálogo completo/i.test(r.note ?? "");
  const head = listed
    ? `${/Sin coincidencias/i.test(r.note ?? "") ? "Sin coincidencias: " : ""}listó el catálogo (${r.total})`
    : `${names.length === 1 ? "Encontró 1" : `Encontró ${names.length}`}`;
  const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ` y ${names.length - 4} más` : "");
  // Con pocos productos, qué datos les faltan: es justo lo que el agente podría
  // inventarse. Primero los que pidió el cliente: esos son los que hay que completar.
  const missing = r.products.length <= 3 ? [...new Set(r.products.flatMap((p) => p.missingDetails ?? []))] : [];
  const askedMissing = missing.filter((l) => asks.includes(l));
  const otherMissing = missing.filter((l) => !asks.includes(l));
  const notes = [
    askedMissing.length ? ` Pidió ${quoted(askedMissing)} y no está en los campos del producto.` : "",
    otherMissing.length ? ` Sin dato en el producto: ${quoted(otherMissing)}.` : "",
  ].join("");
  return clip(`${head}: ${shown}.${notes}`, MAX_SUMMARY);
}

function knowledge(output: string): string {
  const r = parse(output) as { doc?: string }[] | null;
  if (!Array.isArray(r)) return clip(output, MAX_SUMMARY);
  if (!r.length) return "No encontró nada en el conocimiento.";
  const docs = [...new Set(r.map((h) => h.doc).filter(Boolean))].map((d) => `«${d}»`);
  return clip(`${r.length === 1 ? "1 fragmento" : `${r.length} fragmentos`}${docs.length ? ` de ${docs.join(", ")}` : ""}.`, MAX_SUMMARY);
}

/** Lo que ofreció para pulsar: «Ofreció botones: «Sí, sepárame» · «Tengo dudas»». */
export function buttonsSummary(options: string[]): string {
  if (!options.length) return "Quiso ofrecer botones sin opciones válidas: respondió solo con texto.";
  return `Ofreció ${optionsAsButtons(options) ? "botones" : "una lista"}: ${options.map((o) => `«${o}»`).join(" · ")}`;
}

/** Una línea por consulta del agente, para enseñarla bajo su respuesta en la prueba. */
export function traceToolCall(name: string, input: Record<string, unknown> | undefined, output: string): PlaygroundToolCall {
  // La respuesta con botones: lo que ofreció ya viene resumido (buttonsSummary).
  if (name === REPLY_BUTTONS_TOOL) return { name, input: "", summary: clip(output, MAX_SUMMARY) };
  if (name === "search_products") {
    // La búsqueda y, aparte, qué dato pidió el cliente: «genómica» · pide «Temario».
    const asks = asksOf(input);
    const q = typeof input?.query === "string" ? input.query.trim() : "";
    const query = q ? `«${q}»` : "";
    const asked = asks.length ? `pide ${quoted(asks)}` : "";
    return { name, input: clip([query, asked].filter(Boolean).join(" · "), MAX_INPUT), summary: products(output, asks) };
  }
  const summary =
    name === "search_knowledge"
      ? knowledge(output)
      : name === "search_contact"
        ? "Leyó la ficha del cliente."
        : clip(output.replace(/\s+/g, " ").trim(), MAX_SUMMARY);
  return { name, input: inputText(input), summary };
}
