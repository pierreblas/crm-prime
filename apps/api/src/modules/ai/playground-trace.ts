import type { PlaygroundToolCall } from "@crm/shared";

/**
 * Lo que consultó el agente en «Probar conversación», en una línea por consulta:
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

function products(output: string): string {
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
  // Con pocos productos, qué datos les faltan: es justo lo que el agente podría inventarse.
  const missing =
    r.products.length <= 3
      ? [...new Set(r.products.flatMap((p) => p.missingDetails ?? []))].map((l) => `«${l}»`)
      : [];
  return clip(`${head}: ${shown}.${missing.length ? ` Sin dato en el producto: ${missing.join(", ")}.` : ""}`, MAX_SUMMARY);
}

function knowledge(output: string): string {
  const r = parse(output) as { doc?: string }[] | null;
  if (!Array.isArray(r)) return clip(output, MAX_SUMMARY);
  if (!r.length) return "No encontró nada en el conocimiento.";
  const docs = [...new Set(r.map((h) => h.doc).filter(Boolean))].map((d) => `«${d}»`);
  return clip(`${r.length === 1 ? "1 fragmento" : `${r.length} fragmentos`}${docs.length ? ` de ${docs.join(", ")}` : ""}.`, MAX_SUMMARY);
}

/** Una línea por consulta del agente, para enseñarla bajo su respuesta en la prueba. */
export function traceToolCall(name: string, input: Record<string, unknown> | undefined, output: string): PlaygroundToolCall {
  const summary =
    name === "search_products"
      ? products(output)
      : name === "search_knowledge"
        ? knowledge(output)
        : name === "search_contact"
          ? "Leyó la ficha del cliente de prueba."
          : clip(output.replace(/\s+/g, " ").trim(), MAX_SUMMARY);
  return { name, input: inputText(input), summary };
}
