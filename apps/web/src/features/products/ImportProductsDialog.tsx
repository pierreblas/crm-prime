"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import {
  CURRENCIES,
  guessPriceColumns,
  PRODUCT_IMPORT_FIELDS,
  csvToRecords,
  guessColumnMapping,
  formatFieldValue,
  guessProductFieldColumns,
  parseCsv,
  sheetToTable,
  toCsv,
  toProductImportRow,
  type ImportProductsResult,
  type ProductImportField,
  type ProductImportRow,
} from "@crm/shared";
import { fetchProductFields, importProducts } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";

type Mapping = Record<ProductImportField, string | null>;

interface Parsed {
  fileName: string;
  headers: string[];
  records: Record<string, string>[];
}

const PREVIEW_ROWS = 6;

// Plantilla de ejemplo: columnas en inglés (las de siempre en español también
// se reconocen) y productos en distintas monedas, con precios extra por moneda.
const TEMPLATE_HEADERS = ["name", "sku", "price", "currency", "price_USD", "price_MXN", "description", "image_url", "active"];
const TEMPLATE_ROWS: string[][] = [
  ["Camiseta azul", "CAM-001", "59.90", "PEN", "16", "290", "Algodón 100%", "https://misitio.com/camiseta.jpg", "yes"],
  ["Gorra negra", "GOR-002", "12.00", "USD", "", "220", "Talla única", "", "yes"],
  ["Curso online", "CUR-003", "990", "MXN", "55", "", "Acceso por 12 meses", "", "no"],
];
const NUMERIC_TEMPLATE_COLUMNS = new Set(["price", "price_USD", "price_MXN"]);

/**
 * Importa productos desde un Excel (.xlsx) o un CSV. El archivo se lee aquí
 * (nunca se sube), se muestra una vista previa con la correspondencia de
 * columnas y solo se envían las filas ya validadas.
 */
export function ImportProductsDialog({
  onClose,
  onImported,
  suggestedCurrency = "USD",
}: {
  onClose: () => void;
  onImported: () => void;
  /** Moneda propuesta para las filas sin moneda: la más usada en el catálogo. */
  suggestedCurrency?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportProductsResult | null>(null);
  const { data: fields = [] } = useQuery({ queryKey: ["product-fields"], queryFn: fetchProductFields });
  // Columna elegida a mano para cada campo personalizado (si no, se adivina por el nombre).
  const [fieldPick, setFieldPick] = useState<Record<string, string | null>>({});
  // Moneda de las filas que no la traen, y moneda asignada a mano a columnas de precio extra.
  const [defaultCurrency, setDefaultCurrency] = useState(suggestedCurrency);
  const [pricePick, setPricePick] = useState<Record<string, string | null>>({});

  const fieldColumns = useMemo(() => {
    if (!parsed || !mapping) return [];
    return guessProductFieldColumns(parsed.headers, fields, Object.values(mapping)).map((c) =>
      c.key in fieldPick ? { ...c, column: fieldPick[c.key] ?? null } : c,
    );
  }, [parsed, mapping, fields, fieldPick]);
  const usedFields = fieldColumns.filter((c) => c.column);

  // Columnas del archivo que no se usan para nada más: candidatas a precio en otra moneda.
  const extraColumns = useMemo(() => {
    if (!parsed || !mapping) return [];
    const used = new Set([...Object.values(mapping), ...fieldColumns.map((c) => c.column)].filter(Boolean) as string[]);
    return parsed.headers.filter((h) => !used.has(h));
  }, [parsed, mapping, fieldColumns]);
  const priceColumns = useMemo(() => {
    if (!parsed || !mapping) return {};
    const guessed = guessPriceColumns(extraColumns, []);
    const out: Record<string, string> = {};
    for (const h of extraColumns) {
      const cur = h in pricePick ? pricePick[h] : guessed[h];
      if (cur) out[h] = cur;
    }
    return out;
  }, [parsed, mapping, extraColumns, pricePick]);

  // Cada fila del archivo, ya convertida a producto o con su motivo de error.
  const rows = useMemo(() => {
    if (!parsed || !mapping) return [];
    return parsed.records.map((record, i) => ({
      line: i + 2, // +2: la 1 es la cabecera
      ...toProductImportRow(record, mapping, fieldColumns, { defaultCurrency, priceColumns }),
    }));
  }, [parsed, mapping, fieldColumns, defaultCurrency, priceColumns]);

  const valid = rows.filter((r) => r.ok) as {
    line: number;
    ok: true;
    value: ProductImportRow;
  }[];
  const invalid = rows.filter((r) => !r.ok) as {
    line: number;
    ok: false;
    error: string;
  }[];

  const importMut = useMutation({
    mutationFn: () =>
      importProducts({
        rows: valid.map((r) => r.value),
        updateExisting,
      }),
    onSuccess: (r) => {
      setResult(r);
      onImported();
    },
  });

  async function onFile(file: File) {
    setReadError(null);
    setResult(null);
    try {
      if (/\.xls$/i.test(file.name)) {
        setReadError("Los .xls antiguos no se pueden leer. En Excel: «Guardar como» → Libro de Excel (.xlsx), o exporta a CSV.");
        return;
      }
      const isXlsx = /\.xlsx$/i.test(file.name) || file.type.includes("spreadsheetml");
      // Excel: la primera hoja. Cada celda se vuelve texto, como en un CSV.
      const table = isXlsx
        ? sheetToTable((await readSheet(file, 1)) as unknown[][])
        : parseCsv(await file.text());
      if (table.headers.length === 0) {
        setReadError("El archivo está vacío.");
        return;
      }
      const records = csvToRecords(table);
      if (records.length === 0) {
        setReadError("El archivo solo tiene la fila de títulos.");
        return;
      }
      setParsed({ fileName: file.name, headers: table.headers, records });
      setMapping(guessColumnMapping(table.headers));
      setFieldPick({});
      setPricePick({});
    } catch (e) {
      setReadError(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  }

  async function downloadTemplate(format: "xlsx" | "csv") {
    // Una columna por cada campo personalizado, con un valor de ejemplo válido.
    const sample = (f: (typeof fields)[number]): string => {
      switch (f.type) {
        case "select":
          return f.options[0] ?? "";
        case "multiselect":
          return f.options.slice(0, 2).join(", ");
        case "number":
          return "1";
        case "date":
          return "31/01/2026";
        case "time":
          return "18:30";
        case "boolean":
          return "si";
        case "url":
          return "https://misitio.com";
        default:
          return f.required ? "…" : "";
      }
    };
    const headers = [...TEMPLATE_HEADERS, ...fields.map((f) => f.label)];
    // Los campos obligatorios van rellenos en todas las filas; los demás, solo en la primera.
    const rows = TEMPLATE_ROWS.map((r, i) => [...r, ...fields.map((f) => (i === 0 || f.required ? sample(f) : ""))]);
    if (format === "csv") {
      const csv = toCsv(headers, rows);
      const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "products-template.csv";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    // Excel: títulos en negrita y los precios como números.
    await writeXlsxFile(
      [
        headers.map((h) => ({ value: h, fontWeight: "bold" as const })),
        ...rows.map((r) =>
          r.map((v, i) =>
            v === ""
              ? null
              : NUMERIC_TEMPLATE_COLUMNS.has(headers[i]!) && !Number.isNaN(Number(v))
                ? { value: Number(v), type: Number }
                : { value: v, type: String },
          ),
        ),
      ],
      { columns: headers.map((h) => ({ width: Math.max(12, Math.min(28, h.length + 6)) })) },
    ).toFile("products-template.xlsx");
  }

  const missingRequired = PRODUCT_IMPORT_FIELDS.filter(
    (f) => f.required && mapping && !mapping[f.key],
  );

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        style={{ width: "min(720px, calc(100vw - 32px))", maxHeight: "86vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 4px" }}>Importar productos</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
          Sube un Excel (.xlsx) o un CSV, por ejemplo exportado de Google Sheets. Cada
          producto lleva su moneda; los que tengan un SKU que ya existe se actualizan y el
          resto se crean.
        </p>

        {/* Resultado final */}
        {result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 20 }}>
              <Stat label="Creados" value={result.created} color="#7ee2a8" />
              <Stat label="Actualizados" value={result.updated} color="#7fb7ff" />
              <Stat
                label="Omitidos"
                value={result.skipped}
                color={result.skipped ? "#e0b766" : undefined}
              />
            </div>
            {result.errors.length > 0 && (
              <div style={errorBox}>
                {result.errors.slice(0, 20).map((e) => (
                  <div key={e.row}>
                    Fila {e.row}: {e.message}
                  </div>
                ))}
                {result.errors.length > 20 && (
                  <div>y {result.errors.length - 20} más…</div>
                )}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={primaryBtn}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Paso 1: archivo */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
              <button onClick={() => fileRef.current?.click()} style={primaryBtn}>
                {parsed ? "Elegir otro archivo" : "Elegir archivo (Excel o CSV)"}
              </button>
              <button onClick={() => void downloadTemplate("xlsx")} style={ghostBtn} title="Ejemplo con productos en varias monedas">
                Plantilla Excel
              </button>
              <button onClick={() => void downloadTemplate("csv")} style={ghostBtn} title="La misma plantilla, en CSV">
                Plantilla CSV
              </button>
              {parsed && (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {parsed.fileName} · {parsed.records.length} fila(s)
                </span>
              )}
            </div>

            {readError && (
              <p style={{ color: "#ff6b6b", fontSize: 13 }}>{readError}</p>
            )}

            {parsed && mapping && (
              <>
                {/* Paso 2: columnas */}
                <h4 style={{ margin: "18px 0 8px" }}>Columnas</h4>
                <div style={mapGrid}>
                  {PRODUCT_IMPORT_FIELDS.map((f) => (
                    <label key={f.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ width: 110, fontSize: 13, color: "var(--muted)" }}>
                        {f.label}
                        {f.required && <span style={{ color: "#e08a8a" }}> *</span>}
                      </span>
                      <select
                        style={select}
                        value={mapping[f.key] ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [f.key]: e.target.value || null })
                        }
                      >
                        <option value="">— sin usar —</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }} title="Se usa en las filas que no indican moneda (o si el archivo no tiene esa columna)">
                    <span style={{ width: 110, fontSize: 13, color: "var(--muted)" }}>Si falta la moneda</span>
                    <select style={select} value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} aria-label="Moneda si falta">
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {fieldColumns.length > 0 && (
                  <>
                    <h4 style={{ margin: "16px 0 8px" }}>Tus campos</h4>
                    <div style={mapGrid}>
                      {fieldColumns.map((c) => (
                        <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ width: 110, fontSize: 13, color: "var(--muted)" }}>
                            {c.label}
                            {c.required && <span style={{ color: "#e08a8a" }}> *</span>}
                          </span>
                          <select
                            style={select}
                            value={c.column ?? ""}
                            onChange={(e) => setFieldPick({ ...fieldPick, [c.key]: e.target.value || null })}
                          >
                            <option value="">— sin usar —</option>
                            {parsed.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {extraColumns.length > 0 ? (
                  <>
                    <h4 style={{ margin: "16px 0 8px" }}>Otras columnas</h4>
                    <div style={mapGrid}>
                      {extraColumns.map((h) => (
                        <label key={h} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ width: 110, fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h}>
                            {h}
                          </span>
                          <select style={select} value={priceColumns[h] ?? ""} onChange={(e) => setPricePick({ ...pricePick, [h]: e.target.value || null })} aria-label={`Columna ${h}`}>
                            <option value="">— no se importa —</option>
                            {CURRENCIES.map((c) => (
                              <option key={c.code} value={c.code}>
                                Precio en {c.code} · {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "8px 0 0" }}>
                      Una columna llamada price_USD o precio_MXN se reconoce sola como precio en esa moneda; cualquier otra puedes marcarla aquí.
                    </p>
                  </>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "8px 0 0" }}>
                    La columna currency (o moneda) da la moneda de cada producto. Para precios en otras monedas, añade columnas como price_USD o price_MXN.
                  </p>
                )}

                {missingRequired.length > 0 && (
                  <p style={{ color: "#e0b766", fontSize: 13 }}>
                    <NavIcon name="alert" size={13} /> Falta indicar:{" "}
                    {missingRequired.map((f) => f.label).join(", ")}
                  </p>
                )}

                {/* Paso 3: vista previa */}
                <h4 style={{ margin: "18px 0 8px" }}>
                  Vista previa · {valid.length} lista(s) para importar
                  {invalid.length > 0 && `, ${invalid.length} con problemas`}
                </h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Fila</th>
                        <th style={th}>Nombre</th>
                        <th style={th}>SKU</th>
                        <th style={th}>Precio</th>
                        <th style={th}>Activo</th>
                        {usedFields.map((c) => (
                          <th key={c.key} style={th}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, PREVIEW_ROWS).map((r) => (
                        <tr key={r.line}>
                          <td style={td}>{r.line}</td>
                          {r.ok ? (
                            <>
                              <td style={td}>{r.value.name}</td>
                              <td style={td}>{r.value.sku ?? "—"}</td>
                              <td style={td}>
                                {r.value.price.toFixed(2)} {r.value.currency}
                                {r.value.prices.length > 0 && (
                                  <span style={{ color: "var(--muted)" }}>
                                    {" · "}
                                    {r.value.prices.map((p) => `${p.amount.toFixed(2)} ${p.currency}`).join(" · ")}
                                  </span>
                                )}
                              </td>
                              <td style={td}>{r.value.isActive ? "Sí" : "No"}</td>
                              {usedFields.map((c) => (
                                <td key={c.key} style={td}>
                                  {formatFieldValue(c, r.value.attributes?.[c.key] ?? "") || "—"}
                                </td>
                              ))}
                            </>
                          ) : (
                            <td style={{ ...td, color: "#e08a8a" }} colSpan={4 + usedFields.length}>
                              {r.error}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > PREVIEW_ROWS && (
                  <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
                    Se muestran las primeras {PREVIEW_ROWS} filas.
                  </p>
                )}

                {invalid.length > 0 && (
                  <div style={errorBox}>
                    {invalid.slice(0, 10).map((r) => (
                      <div key={r.line}>
                        Fila {r.line}: {r.error}
                      </div>
                    ))}
                    {invalid.length > 10 && <div>y {invalid.length - 10} más…</div>}
                    <div style={{ marginTop: 6 }}>
                      Estas filas no se importan; el resto sí.
                    </div>
                  </div>
                )}

                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                  />
                  Actualizar los productos cuyo SKU ya exista
                </label>
              </>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              {importMut.isError && (
                <span style={{ color: "#ff6b6b", fontSize: 13, alignSelf: "center" }}>
                  {(importMut.error as Error).message}
                </span>
              )}
              <button onClick={onClose} style={ghostBtn}>
                Cancelar
              </button>
              <button
                onClick={() => importMut.mutate()}
                disabled={valid.length === 0 || importMut.isPending}
                style={primaryBtn}
              >
                {importMut.isPending
                  ? "Importando…"
                  : `Importar ${valid.length} producto(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

const mapGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 8,
};

const select: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  color: "var(--muted)",
  fontWeight: 500,
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--border)",
};

const errorBox: React.CSSProperties = {
  background: "rgba(200,80,80,0.1)",
  border: "1px solid #5a2a2a",
  borderRadius: 8,
  padding: 10,
  fontSize: 12.5,
  color: "#ffb3b3",
  marginTop: 10,
  maxHeight: 160,
  overflowY: "auto",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};
