"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readSheet } from "read-excel-file/browser";
import {
  CONTACT_IMPORT_COLUMNS,
  COUNTRIES,
  csvToRecords,
  dialCodeOf,
  fieldKeyFromLabel,
  guessContactColumns,
  parseCsv,
  sheetToTable,
  toContactImportRow,
  toCsv,
  type ContactImportColumn,
  type ContactImportRow,
  type CustomFieldDto,
  type ImportContactsResult,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { fetchCustomFields, importContacts } from "@/lib/bff";

const NEW = "__new";
const SKIP = "";
const PREVIEW = 5;

interface Parsed {
  fileName: string;
  headers: string[];
  records: Record<string, string>[];
}

/** País por defecto: el de la región del navegador (es-PE → PE), si existe. */
function browserCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  } catch {
    /* sin Intl.Locale */
  }
  return "";
}

/** Columna del archivo → campo existente, si el título coincide con su clave o su nombre. */
function matchField(header: string, fields: CustomFieldDto[]): string | null {
  const k = fieldKeyFromLabel(header);
  return fields.find((f) => f.key === k || fieldKeyFromLabel(f.label) === k)?.key ?? null;
}

/**
 * Importa contactos desde Excel (.xlsx) o CSV. El archivo se lee en el
 * navegador: al servidor solo llegan las filas ya validadas.
 */
export function ImportContactsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { data: fields = [] } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<ContactImportColumn, string | null> | null>(null);
  // Destino de cada columna restante: clave de un campo, NEW (crear) o SKIP.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [country, setCountry] = useState(browserCountry);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [optIn, setOptIn] = useState(true);
  const [result, setResult] = useState<ImportContactsResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fixedCols = useMemo(() => new Set(Object.values(columns ?? {}).filter(Boolean) as string[]), [columns]);
  const otherHeaders = useMemo(() => (parsed ? parsed.headers.filter((h) => !fixedCols.has(h)) : []), [parsed, fixedCols]);

  // Claves de los campos nuevos: del título, sin chocar con las que ya hay.
  const newFieldKeys = useMemo(() => {
    const taken = new Set(fields.map((f) => f.key));
    const out: Record<string, string> = {};
    for (const h of otherHeaders) {
      if (targets[h] !== NEW) continue;
      const base = fieldKeyFromLabel(h);
      let k = base;
      let i = 1;
      while (taken.has(k)) k = `${base}_${i++}`.slice(0, 40);
      taken.add(k);
      out[h] = k;
    }
    return out;
  }, [otherHeaders, targets, fields]);

  const fieldColumns = useMemo(
    () =>
      otherHeaders
        .map((h) => ({ column: h, key: targets[h] === NEW ? newFieldKeys[h] : targets[h] }))
        .filter((c): c is { column: string; key: string } => !!c.key),
    [otherHeaders, targets, newFieldKeys],
  );

  const rows = useMemo(() => {
    if (!parsed || !columns) return [];
    const dial = country ? dialCodeOf(country) : null;
    return parsed.records.map((r, i) => toContactImportRow(r, i + 2, columns, fieldColumns, { defaultDial: dial }));
  }, [parsed, columns, fieldColumns, country]);
  const valid = rows.filter((r) => r.ok).map((r) => (r as { value: ContactImportRow }).value);
  const invalid = rows
    .map((r, i) => ({ r, line: i + 2 }))
    .filter((x) => !x.r.ok)
    .map((x) => ({ line: x.line, error: (x.r as { error: string }).error }));

  const run = useMutation({
    mutationFn: () =>
      importContacts({
        rows: valid,
        newFields: otherHeaders.filter((h) => targets[h] === NEW).map((h) => ({ key: newFieldKeys[h]!, label: h.trim().slice(0, 80), type: "text" as const })),
        updateExisting,
        optIn,
        fileName: parsed?.fileName ?? null,
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["custom-fields"] });
      qc.invalidateQueries({ queryKey: ["custom-fields-unmapped"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
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
      const table = isXlsx ? sheetToTable((await readSheet(file, 1)) as unknown[][]) : parseCsv(await file.text());
      if (!table.headers.length) return setReadError("El archivo está vacío.");
      const records = csvToRecords(table);
      if (!records.length) return setReadError("El archivo solo tiene la fila de títulos.");
      if (records.length > 5000) return setReadError(`El archivo tiene ${records.length} filas: el máximo por importación es 5000. Divídelo en varios.`);
      const cols = guessContactColumns(table.headers);
      const used = new Set(Object.values(cols).filter(Boolean) as string[]);
      const t: Record<string, string> = {};
      for (const h of table.headers) if (!used.has(h)) t[h] = matchField(h, fields) ?? NEW;
      setParsed({ fileName: file.name, headers: table.headers, records });
      setColumns(cols);
      setTargets(t);
    } catch (e) {
      setReadError(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  }

  function downloadTemplate() {
    const headers = ["telefono", "nombre", "etiquetas", "fuente", ...fields.map((f) => f.label)];
    const rowsT = [
      ["+51987654321", "Lucía Ramos", "cliente, vip", "Feria 2026", ...fields.map(() => "")],
      ["987123456", "Diego Paredes", "interesado", "", ...fields.map(() => "")],
    ];
    const url = URL.createObjectURL(new Blob(["﻿" + toCsv(headers, rowsT)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "contactos-plantilla.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const setCol = (k: ContactImportColumn, v: string) => {
    if (!columns) return;
    const next = { ...columns, [k]: v || null };
    setColumns(next);
    // La columna que deja de ser fija vuelve a la lista de campos.
    const prev = columns[k];
    if (prev && !Object.values(next).includes(prev)) setTargets((t) => ({ ...t, [prev]: t[prev] ?? matchField(prev, fields) ?? NEW }));
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="imp-backdrop" onClick={onClose} />
      <div className="imp" role="dialog" aria-modal="true" aria-label="Importar contactos" data-import-contacts>
        <header className="imp__head">
          <div>
            <h3>Importar contactos</h3>
            <p>Excel (.xlsx) o CSV. Una fila por contacto; el teléfono es obligatorio.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>

        <div className="imp__body">
          {result ? (
            <div className="imp__result" data-import-result>
              <div className="imp__stats">
                <div><strong>{result.created}</strong><span>nuevos</span></div>
                <div><strong>{result.updated}</strong><span>actualizados</span></div>
                <div><strong>{result.skipped}</strong><span>saltados</span></div>
                {result.fieldsCreated > 0 && <div><strong>{result.fieldsCreated}</strong><span>campos creados</span></div>}
              </div>
              {result.errors.length > 0 && (
                <ul className="imp__errors">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>Línea {e.row}: {e.message}</li>
                  ))}
                  {result.errors.length > 20 && <li>…y {result.errors.length - 20} más.</li>}
                </ul>
              )}
              <p className="imp__note">Los contactos importados no disparan flujos de «lead nuevo». Para escribirles, usa una difusión.</p>
            </div>
          ) : !parsed ? (
            <div className="imp__pick">
              <button type="button" className="imp__drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}>
                <NavIcon name="file" size={22} />
                <strong>Elige un archivo o arrástralo aquí</strong>
                <span>.xlsx o .csv · hasta 5000 filas</span>
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} data-import-file />
              {readError && <p className="imp__error" role="alert">{readError}</p>}
              <button type="button" className="imp__link" onClick={downloadTemplate}>
                <NavIcon name="arrow-down" size={13} /> Descargar plantilla CSV
              </button>
            </div>
          ) : (
            <>
              <div className="imp__file">
                <NavIcon name="file" size={14} />
                <strong>{parsed.fileName}</strong>
                <span>{parsed.records.length} filas</span>
                <button type="button" className="imp__link" onClick={() => { setParsed(null); setColumns(null); }}>cambiar</button>
              </div>

              <section className="imp__sec">
                <h4>Columnas</h4>
                <div className="imp__grid">
                  {CONTACT_IMPORT_COLUMNS.map((c) => (
                    <label key={c.key}>
                      <span>{c.label}{c.required ? " *" : ""}</span>
                      <select className="field field-sm" value={columns?.[c.key] ?? ""} onChange={(e) => setCol(c.key, e.target.value)} data-col={c.key}>
                        <option value="">{c.required ? "Elige la columna…" : "— Ninguna —"}</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    <span>País de los números sin prefijo</span>
                    <select className="field field-sm" value={country} onChange={(e) => setCountry(e.target.value)} data-country>
                      <option value="">Ya llevan prefijo (+…)</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.name} (+{dialCodeOf(c.code)})</option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {otherHeaders.length > 0 && (
                <section className="imp__sec">
                  <h4>Resto de columnas → campos del contacto</h4>
                  <div className="imp__fields">
                    {otherHeaders.map((h) => (
                      <div key={h} className="imp__fieldrow" data-target-row={h}>
                        <span className="imp__colname" title={h}>{h}</span>
                        <NavIcon name="arrow-right" size={12} />
                        <select className="field field-sm" value={targets[h] ?? SKIP} onChange={(e) => setTargets((t) => ({ ...t, [h]: e.target.value }))} aria-label={`Destino de ${h}`}>
                          <option value={SKIP}>No importar</option>
                          <option value={NEW}>Crear campo «{h.trim().slice(0, 40)}»</option>
                          {fields.length > 0 && (
                            <optgroup label="Campos existentes">
                              {fields.map((f) => (
                                <option key={f.key} value={f.key}>{f.label} · {f.key}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {targets[h] === NEW && <code className="imp__newkey" title="Clave del campo nuevo">{newFieldKeys[h]}</code>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="imp__sec">
                <h4>Vista previa</h4>
                {valid.length > 0 ? (
                  <div className="imp__tablewrap">
                    <table className="imp__table">
                      <thead>
                        <tr>
                          <th>Teléfono</th>
                          <th>Nombre</th>
                          <th>Etiquetas</th>
                          {fieldColumns.map((c) => <th key={c.column}>{c.key}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {valid.slice(0, PREVIEW).map((r) => (
                          <tr key={r.line}>
                            <td>{r.phone}</td>
                            <td>{r.name ?? "—"}</td>
                            <td>{r.tags.join(", ") || "—"}</td>
                            {fieldColumns.map((c) => <td key={c.column}>{r.fields[c.key] ?? ""}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="imp__error">Ninguna fila es válida: revisa la columna del teléfono.</p>
                )}
                {invalid.length > 0 && (
                  <details className="imp__invalid" data-invalid>
                    <summary>{invalid.length} fila{invalid.length === 1 ? "" : "s"} no se importará{invalid.length === 1 ? "" : "n"}</summary>
                    <ul>
                      {invalid.slice(0, 20).map((x) => <li key={x.line}>Línea {x.line}: {x.error}</li>)}
                    </ul>
                  </details>
                )}
              </section>

              <section className="imp__sec imp__opts">
                <label className="imp__check">
                  <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                  <span>Si el teléfono ya existe, completar ese contacto (nombre, campos y etiquetas). Si no, se salta.</span>
                </label>
                <label className="imp__check">
                  <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} data-optin />
                  <span>Aceptaron recibir mensajes por WhatsApp. Sin esto, los contactos nuevos no entran en las difusiones.</span>
                </label>
              </section>
              {run.isError && <p className="imp__error" role="alert">{(run.error as Error).message}</p>}
            </>
          )}
        </div>

        <footer className="imp__foot">
          {result ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>Listo</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              {parsed && (
                <button type="button" className="btn btn-primary" disabled={!columns?.phone || valid.length === 0 || run.isPending} onClick={() => run.mutate()} data-import-run>
                  {run.isPending ? "Importando…" : `Importar ${valid.length} contacto${valid.length === 1 ? "" : "s"}`}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </>,
    document.body,
  );
}
