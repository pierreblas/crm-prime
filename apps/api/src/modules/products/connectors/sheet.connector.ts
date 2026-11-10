import { csvToRecords, guessColumnMapping, guessPriceColumns, guessProductFieldColumns, parseCsv, toProductImportRow, type ProductImportRow } from "@crm/shared";
import { readText, safeFetch } from "./http";
import { nameKey } from "./text";
import { ConnectorError, type CatalogConnector, type ExternalProduct, type PullResult, type SourceConfig, type TestResult } from "./types";

/**
 * Una hoja de Google (o cualquier CSV público por enlace) como catálogo vivo:
 * la misma lectura de columnas que el importador de archivos (nombre, precio,
 * moneda, SKU, descripción, imagen, activo, precio_XXX y los campos propios
 * de la empresa por su título), pero leída sola cada cierto tiempo.
 *
 * Google: vale el enlace normal de la hoja si está compartida con «Cualquier
 * persona con el enlace», o el de «Publicar en la web». De los dos se saca la
 * exportación a CSV de la pestaña indicada (gid), y no se guarda nada más.
 */

const NOT_PUBLIC =
  "No se pudo leer la hoja: no es pública. En Google Sheets, Compartir › «Cualquier persona con el enlace» (Lector), o Archivo › Compartir › Publicar en la web.";

export class SheetConnector implements CatalogConnector {
  readonly kind = "sheet" as const;

  normalizeTarget(raw: string): string {
    let value = raw.trim();
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ConnectorError("El enlace no es válido");
    }
    if (url.hostname === "docs.google.com" && url.pathname.startsWith("/spreadsheets/")) {
      const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid") ?? "0";
      const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)/);
      if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv&single=true&gid=${gid}`;
      const doc = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
      if (doc) return `https://docs.google.com/spreadsheets/d/${doc[1]}/export?format=csv&gid=${gid}`;
      throw new ConnectorError("Pega el enlace de la hoja de cálculo (docs.google.com/spreadsheets/d/…)");
    }
    url.hash = "";
    return url.toString();
  }

  async test(cfg: SourceConfig): Promise<TestResult> {
    const { rows, warnings } = await this.read(cfg);
    return {
      ok: true,
      name: null,
      currency: cfg.defaultCurrency ?? rows[0]?.currency ?? null,
      count: rows.length,
      sample: rows.slice(0, 5).map((r) => r.name),
      warnings,
    };
  }

  async pull(cfg: SourceConfig): Promise<PullResult> {
    const { rows, warnings } = await this.read(cfg);
    const items: ExternalProduct[] = rows.map((r) => ({
      externalId: r.sku ? `sku:${r.sku}` : `name:${nameKey(r.name)}`,
      name: r.name,
      sku: r.sku,
      description: r.description,
      price: r.price,
      currency: r.currency,
      imageUrl: r.imageUrl,
      isActive: r.isActive,
      attributes: r.attributes,
      prices: r.prices,
    }));
    return { items, storeName: null, currency: cfg.defaultCurrency, fields: [], warnings };
  }

  private async read(cfg: SourceConfig): Promise<{ rows: ProductImportRow[]; warnings: string[] }> {
    const res = await safeFetch(cfg.target, { headers: { Accept: "text/csv,text/plain,*/*" } }, { allowCrossHost: true, timeoutMs: 30_000 });
    if (res.status === 401 || res.status === 403) throw new ConnectorError(NOT_PUBLIC);
    if (res.status === 404) throw new ConnectorError("El enlace no existe (404). Vuelve a copiarlo desde la barra del navegador.");
    if (!res.ok) throw new ConnectorError(`El enlace respondió ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    const text = await readText(res, 20_000_000);
    if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) throw new ConnectorError(NOT_PUBLIC);

    const table = parseCsv(text);
    if (!table.headers.length) throw new ConnectorError("La hoja está vacía");
    const headers = table.headers;
    const mapping = guessColumnMapping(headers);
    if (!mapping.name || !mapping.price) {
      throw new ConnectorError(
        `No encuentro las columnas de nombre y precio. Títulos vistos: ${headers.slice(0, 12).join(", ")}${headers.length > 12 ? "…" : ""}. Llama a las columnas «nombre» y «precio» (o name y price).`,
      );
    }
    const fieldColumns = guessProductFieldColumns(headers, cfg.fields, Object.values(mapping));
    const priceColumns = guessPriceColumns(headers, [...Object.values(mapping), ...fieldColumns.map((c) => c.column)]);

    const rows: ProductImportRow[] = [];
    const errors: string[] = [];
    const records = csvToRecords(table);
    for (const [i, record] of records.entries()) {
      // Filas en blanco (muy normales al final de una hoja) no son errores.
      if (!Object.values(record).some((v) => v.trim())) continue;
      const r = toProductImportRow(record, mapping, fieldColumns, { defaultCurrency: cfg.defaultCurrency ?? undefined, priceColumns });
      if (r.ok) rows.push(r.value);
      else errors.push(`Fila ${i + 2}: ${r.error}`);
    }
    if (!rows.length) throw new ConnectorError(errors[0] ? `Ninguna fila sirve. ${errors[0]}` : "La hoja solo tiene la fila de títulos");

    const warnings = errors.slice(0, 10);
    if (errors.length > 10) warnings.push(`y ${errors.length - 10} fila(s) más con problemas`);
    if (!mapping.sku) {
      warnings.push("Sin columna SKU: cada producto se reconoce por su nombre. Si cambias un nombre, se creará uno nuevo y el anterior quedará inactivo.");
    }
    return { rows, warnings };
  }
}
