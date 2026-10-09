// Lector de CSV (RFC 4180) compartido por la web y la API, para que la vista
// previa muestre exactamente lo mismo que acabará guardándose.

const DELIMITERS = [",", ";", "\t"] as const;

/**
 * Adivina el separador mirando la primera línea. Excel en español exporta con
 * ";" y en inglés con ",", así que asumir la coma rompe la mitad de los casos.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    // Solo cuentan los separadores fuera de comillas.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/**
 * Convierte el texto en filas. Respeta comillas, comillas escapadas ("")
 * y saltos de línea dentro de un campo.
 */
export function parseCsv(text: string, delimiter?: string): CsvTable {
  const clean = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];

    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  // Última fila (los archivos no siempre acaban en salto de línea).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Fuera filas totalmente vacías (típicas al final del archivo).
  const data = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const [first, ...rest] = data;
  if (!first) return { headers: [], rows: [] };

  return { headers: first.map((h) => h.trim()), rows: rest };
}

/** Convierte cada fila en un objeto con las cabeceras como claves. */
export function csvToRecords(table: CsvTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const record: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      record[h] = (row[i] ?? "").trim();
    });
    return record;
  });
}

/** Genera un CSV a partir de filas de texto (para la plantilla de ejemplo). */
export function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) =>
    /[",;\t\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [headers, ...rows]
    .map((r) => r.map(escape).join(","))
    .join("\r\n");
}

// ── Hojas de cálculo (xlsx) ──────────────────────────────────

/**
 * Una celda de hoja de cálculo como texto, igual que vendría en un CSV:
 * fechas como 31/12/2026 (o 18:30 si la celda era solo una hora), números
 * sin separadores de miles ni notación local, sí/no como true/false.
 */
export function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    const hhmm = `${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
    // Excel guarda una hora suelta como fecha en su «día cero» (1899-12-30/31).
    if (v.getUTCFullYear() < 1900) return hhmm;
    const date = `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    return hhmm === "00:00" ? date : `${date} ${hhmm}`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

/** Filas de una hoja (la primera son los títulos) → la misma tabla que da parseCsv. */
export function sheetToTable(rows: unknown[][]): CsvTable {
  const [first, ...rest] = rows;
  const headers = (first ?? []).map(cellToString);
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const body = rest
    .map((r) => headers.map((_, i) => cellToString(r?.[i])))
    .filter((r) => r.some((c) => c !== ""));
  return { headers, rows: body };
}
