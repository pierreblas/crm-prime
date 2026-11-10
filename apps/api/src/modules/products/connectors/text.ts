// Utilidades de texto de los conectores: claves de campo, HTML a texto, recortes.
import { productFieldKey } from "@crm/shared";

const RESERVED = new Set(["stock", "enlace", "categoria"]);

/** La misma regla que usan los campos de producto creados a mano (product-fields.controller). */
export function fieldKey(label: string): string {
  const key = productFieldKey(label);
  // Una opción de variante llamada «Stock» no debe pisar el stock de la tienda.
  return RESERVED.has(key) ? `opcion_${key}` : key;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ntilde: "ñ", Ntilde: "Ñ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", uuml: "ü", iquest: "¿", iexcl: "¡",
};

/** Descripciones de WooCommerce (HTML) a texto plano legible, con saltos de párrafo. */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div|\/tr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

export function clip(text: string | null, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Nombre sin tildes ni mayúsculas, para reconocer una fila de hoja sin SKU. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function toNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
