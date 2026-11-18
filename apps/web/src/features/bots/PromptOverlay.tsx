"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "@/components/NavIcons";
import { smBtn } from "@/components/ui";
import { ghostBtn } from "./styles";
import { varKey } from "@crm/shared";
import {
  collectMarks,
  findHeadings,
  pendingSummary,
  productDataFields,
  productDataSentence,
  segments,
  PRODUCT_BASE_FIELDS,
  type Mark,
  type ProductDataField,
  type PromptTool,
  type PromptVar,
} from "./promptMarks";
import type { TextHistory } from "./useTextHistory";
import { TOOL_COPY, TOOL_SNIPPET } from "./agentCopy";

/**
 * «Cómo debe atender» a pantalla grande. El mismo texto, con sitio para
 * leerlo entero, y lo que importa señalado encima: marcadores por rellenar,
 * acciones del agente (y si están activadas) y títulos de sección. El panel
 * de la derecha lista esos elementos: un clic lleva al sitio o lo inserta.
 *
 * El resaltado es una capa con el mismo texto debajo de un textarea con la
 * tinta transparente: la escritura sigue siendo la de siempre. El deshacer es
 * el del editor (history), compartido con el cuadro pequeño.
 */
export function PromptOverlay({
  value,
  history,
  onClose,
  onAssist,
  tools,
  productFields,
  contactVars,
}: {
  value: string;
  history: TextHistory;
  onClose: () => void;
  onAssist: () => void;
  tools: PromptTool[];
  /** Campos propios del catálogo; los apagados para la IA se enseñan aparte. */
  productFields: { label: string; aiVisible: boolean }[];
  /** Variables del contacto que se reemplazan en el texto ({{nombre}}…). */
  contactVars: PromptVar[];
}) {
  const onChange = history.change;
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const backdrop = useRef<HTMLDivElement | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  // Dónde dejó el cursor la persona (null = aún no hizo clic en el texto). Las
  // acciones y datos del panel se insertan ahí, nunca «al final» por defecto.
  const caret = useRef<{ start: number; end: number } | null>(null);
  // Lo que se pulsó en el panel antes de elegir sitio: se inserta con el
  // siguiente clic en el texto (o «al final», si lo pide).
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  // El texto de ahora: lo que espera sitio se inserta sobre lo último escrito, no sobre lo de cuando se pulsó.
  const valueRef = useRef(value);
  valueRef.current = value;
  // Lo recién insertado se ilumina un momento para que se vea dónde quedó.
  const [flash, setFlash] = useState<{ start: number; end: number } | null>(null);

  // `onClose` llega nuevo en cada render del editor: por ref, para que abrir
  // (foco, Esc, bloquear el scroll de la página) ocurra una sola vez y no en
  // cada tecla.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // Abre arriba del todo, sin mover la vista al final del texto.
    ta.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Con algo esperando sitio, Esc lo cancela; si no, cierra.
      if (waitingRef.current) setWaiting(null);
      else onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const dataFields = useMemo(() => productDataFields(productFields), [productFields]);
  const marks = useMemo(() => collectMarks(value, tools, contactVars, dataFields), [value, tools, contactVars, dataFields]);
  const parts = useMemo(() => {
    if (!flash || flash.end > value.length) return segments(value, marks);
    // El tramo insertado manda sobre cualquier otra marca que lo pise.
    const shown: Mark[] = [
      ...marks.filter((m) => m.end <= flash.start || m.start >= flash.end),
      { start: flash.start, end: flash.end, kind: "flash" as const, text: value.slice(flash.start, flash.end) },
    ].sort((a, b) => a.start - b.start);
    return segments(value, shown);
  }, [value, marks, flash]);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(id);
  }, [flash]);
  const pending = useMemo(() => pendingSummary(marks), [marks]);
  const pendingAll = useMemo(() => marks.filter((m) => m.kind === "pending"), [marks]);
  const headings = useMemo(() => findHeadings(value), [value]);
  const mentioned = useMemo(() => new Set(marks.filter((m) => m.kind === "tool" || m.kind === "tool-off").map((m) => m.text)), [marks]);
  const offMentioned = tools.filter((t) => !t.enabled && mentioned.has(t.name));
  const unknownVars = [...new Set(marks.filter((m) => m.kind === "var-off").map((m) => m.text))];
  const sendsImages = tools.some((t) => t.name === "send_product_image" && t.enabled);
  const readsCatalog = tools.some((t) => t.name === "search_products" && t.enabled);
  const visibleData = dataFields.filter((f) => f.visible);
  const hiddenFields = productFields.filter((f) => !f.aiVisible);
  // Datos del producto que ya nombra el texto («Precio»…), y los que nombra pero el agente no recibe.
  const dataNamed = new Set(marks.filter((m) => m.kind === "data").map((m) => varKey(m.text)));
  const hiddenNamed = [...new Set(marks.filter((m) => m.kind === "data-off").map((m) => m.text))];
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  const syncScroll = useCallback(() => {
    const t = ta.current;
    const b = backdrop.current;
    if (t && b) {
      b.scrollTop = t.scrollTop;
      b.scrollLeft = t.scrollLeft;
    }
  }, []);

  /** Lleva el cursor (y la vista) a un tramo del texto. */
  const goTo = useCallback((start: number, end: number) => {
    const t = ta.current;
    const b = backdrop.current;
    if (!t) return;
    const el = b?.querySelector<HTMLElement>(`[data-pos="${start}"]`);
    if (el && b) {
      b.scrollTop = Math.max(0, el.offsetTop - b.clientHeight / 3);
      t.scrollTop = b.scrollTop;
    }
    t.focus({ preventScroll: true });
    t.setSelectionRange(start, end);
    caret.current = { start, end };
    setRailOpen(false);
  }, []);

  const rememberCaret = useCallback(() => {
    const t = ta.current;
    if (!t || document.activeElement !== t) return;
    caret.current = { start: t.selectionStart, end: t.selectionEnd };
  }, []);

  /** Centra en la vista una posición del texto (el textarea y su capa de resaltado a la vez). */
  const reveal = useCallback((pos: number) => {
    const t = ta.current;
    const b = backdrop.current;
    const el = b?.querySelector<HTMLElement>(`[data-pos="${pos}"]`);
    if (!t || !b || !el) return;
    b.scrollTop = Math.max(0, el.offsetTop - b.clientHeight / 2);
    t.scrollTop = b.scrollTop;
  }, []);

  /** Tras insertar: lo nuevo se ilumina, el cursor queda detrás y la vista lo centra. */
  const settle = useCallback(
    (start: number, end: number, next: number) => {
      const t = ta.current;
      if (!t) return;
      caret.current = { start: next, end: next };
      setFlash({ start, end });
      setRailOpen(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const scroll = backdrop.current?.scrollTop ?? t.scrollTop;
          t.focus({ preventScroll: true });
          t.setSelectionRange(next, next);
          t.scrollTop = scroll;
          reveal(start);
        }),
      );
    },
    [reveal],
  );

  /**
   * Hace `run` donde dejó el cursor. Si aún no hizo clic en el texto, no se
   * adivina el sitio: queda esperando y se hace con el siguiente clic en el
   * texto (el aviso sale en el propio cuadro, a la vista, y deja ponerlo al final).
   */
  const place = useCallback((what: string, run: (at: Caret) => void) => {
    if (ta.current && caret.current) {
      setWaiting(null);
      run(caret.current);
      return;
    }
    setWaiting({ what, run });
    setRailOpen(false);
  }, []);

  /** Inserta un texto en un sitio (con espacios alrededor si hace falta). */
  const insertAt = useCallback(
    (token: string, at: Caret) => {
      const text = valueRef.current;
      const before = text.slice(0, at.start);
      const after = text.slice(at.end);
      const padL = before && !/\s$/.test(before) ? " " : "";
      const padR = after && !/^[\s.,;:)»]/.test(after) ? " " : "";
      onChange(`${before}${padL}${token}${padR}${after}`, "edit");
      const start = at.start + padL.length;
      settle(start, start + token.length, start + token.length + padR.length);
    },
    [onChange, settle],
  );

  /**
   * Inserta una frase entera en su propia línea, debajo de la línea donde está
   * el cursor: así no parte por la mitad la frase que había.
   */
  const insertLineAt = useCallback(
    (sentence: string, at: Caret) => {
      const text = valueRef.current;
      const eol = text.indexOf("\n", at.end);
      const pos = eol === -1 ? text.length : eol;
      const before = text.slice(0, pos);
      const lineSoFar = before.slice(before.lastIndexOf("\n") + 1);
      const lead = lineSoFar.trim() ? "\n" : "";
      onChange(`${before}${lead}${sentence}${text.slice(pos)}`, "edit");
      const start = pos + lead.length;
      settle(start, start + sentence.length, start + sentence.length);
    },
    [onChange, settle],
  );

  const insert = useCallback((token: string) => place(token, (at) => insertAt(token, at)), [place, insertAt]);
  const insertLine = useCallback((what: string, sentence: string) => place(what, (at) => insertLineAt(sentence, at)), [place, insertLineAt]);

  /** Clic en el texto: recuerda el sitio y, si algo esperaba sitio, lo pone ahí. */
  const onTextClick = useCallback(() => {
    rememberCaret();
    const w = waitingRef.current;
    if (w && caret.current) {
      setWaiting(null);
      w.run(caret.current);
    }
  }, [rememberCaret]);

  /** «Ponerlo al final»: para quien no quiere elegir sitio (o usa el teclado). */
  const placeAtEnd = useCallback(() => {
    const w = waitingRef.current;
    if (!w) return;
    const end = valueRef.current.length;
    setWaiting(null);
    w.run({ start: end, end });
  }, []);

  /** Lleva a la siguiente mención de una acción (y vuelve a la primera tras la última). */
  const nextMention = useCallback(
    (name: string) => {
      const all = marks.filter((m) => (m.kind === "tool" || m.kind === "tool-off") && m.text === name);
      if (!all.length) return;
      const from = ta.current?.selectionEnd ?? 0;
      const m = all.find((x) => x.start >= from) ?? all[0]!;
      goTo(m.start, m.end);
    },
    [marks, goTo],
  );

  /** Lleva a la siguiente mención de un dato del producto («Precio»…). */
  const nextData = useCallback(
    (label: string) => {
      const all = marks.filter((m) => (m.kind === "data" || m.kind === "data-off") && varKey(m.text) === varKey(label));
      if (!all.length) return;
      const from = ta.current?.selectionEnd ?? 0;
      const m = all.find((x) => x.start >= from) ?? all[0]!;
      goTo(m.start, m.end);
    },
    [marks, goTo],
  );

  const nextPending = useCallback(() => {
    if (!pendingAll.length) return;
    const from = ta.current?.selectionEnd ?? 0;
    const m = pendingAll.find((p) => p.start >= from) ?? pendingAll[0]!;
    goTo(m.start, m.end);
  }, [pendingAll, goTo]);

  const enabledTools = tools.filter((t) => t.enabled);
  const railCount = pending.length + offMentioned.length + unknownVars.length + hiddenNamed.length;

  // En <body>: el panel del agente crea su propio contexto de apilamiento y,
  // dentro de él, el fondo fijo quedaba por debajo de la cabecera de la app.
  return createPortal(
    <div className="confirm-backdrop confirm-backdrop--top" onClick={onClose}>
      <div className="confirm-dialog prompt-overlay prompt-overlay--wide" role="dialog" aria-label="Cómo debe atender, en grande" onClick={(e) => e.stopPropagation()}>
        <header className="prompt-overlay__head">
          <div>
            <h3 style={{ margin: 0 }}>Cómo debe atender</h3>
            <span className="agent-hint">
              Qué vendes y a quién, el tono de tu marca, qué no debe hacer y cuándo pasarte el chat. Lo que va <span className="pm pm-pending">[ENTRE CORCHETES]</span> falta por rellenar.
            </span>
          </div>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={history.undo} disabled={!history.canUndo} style={{ ...ghostBtn, ...smBtn }} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
              <NavIcon name="reply" size={13} />
            </button>
            <button type="button" onClick={history.redo} disabled={!history.canRedo} style={{ ...ghostBtn, ...smBtn }} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
              <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
                <NavIcon name="reply" size={13} />
              </span>
            </button>
            <button
              type="button"
              className="prompt-overlay__railtoggle"
              style={{ ...ghostBtn, ...smBtn }}
              onClick={() => setRailOpen((o) => !o)}
              aria-expanded={railOpen}
            >
              <NavIcon name="target" size={13} /> Elementos{railCount ? ` (${railCount})` : ""}
            </button>
            <button type="button" onClick={onAssist} style={{ ...ghostBtn, ...smBtn }} title="Redactar o mejorar este texto con IA">
              <NavIcon name="sparkles" size={13} /> Asistente
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              Listo
            </button>
          </span>
        </header>

        <div className={`prompt-overlay__body${railOpen ? " is-rail-open" : ""}`}>
          <div className={`prompt-editor${waiting ? " is-asking" : ""}`}>
            <div className="prompt-editor__backdrop" ref={backdrop} aria-hidden="true">
              {parts.map((p, i) =>
                p.mark ? (
                  <mark key={i} className={`pm pm-${p.mark.kind}`} data-pos={p.mark.start}>
                    {p.text}
                  </mark>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
              <br />
            </div>
            <textarea
              ref={ta}
              className="prompt-editor__text"
              value={value}
              onChange={(e) => onChange(e.target.value, "type")}
              onKeyDown={history.onKeyDown}
              onScroll={syncScroll}
              onKeyUp={rememberCaret}
              onMouseUp={onTextClick}
              onInput={rememberCaret}
              aria-label="Cómo debe atender, en grande"
              spellCheck
            />
            {waiting && (
              <div className="prompt-editor__ask" role="status" data-prompt-ask>
                <NavIcon name="target" size={14} />
                <span>
                  Haz clic en el texto donde quieras poner <strong>{waiting.what}</strong>.
                </span>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={placeAtEnd}>
                  Ponerlo al final
                </button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setWaiting(null)} aria-label="Cancelar">
                  <NavIcon name="x" size={12} />
                </button>
              </div>
            )}
          </div>

          <aside className="prompt-rail" aria-label="Elementos del texto">
            <section>
              <h4>
                Por rellenar{pendingAll.length ? ` · ${pendingAll.length}` : ""}
              </h4>
              {pending.length ? (
                <div className="prompt-rail__list">
                  {pending.map((p) => (
                    <button key={p.text} type="button" className="prompt-chip prompt-chip--pending" onClick={() => goTo(p.first.start, p.first.end)} title="Ir al marcador">
                      [{p.text}]{p.count > 1 ? ` ×${p.count}` : ""}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="prompt-rail__hint">Nada pendiente: no hay marcadores entre corchetes.</p>
              )}
            </section>

            <section>
              <h4>Acciones del agente</h4>
              {enabledTools.length ? (
                <>
                  <ul className="prompt-acts">
                    {enabledTools.map((t) => {
                      const used = mentioned.has(t.name);
                      const sentence = TOOL_SNIPPET[t.name] ?? `Usa ${t.name} cuando [CUÁNDO USARLA].`;
                      return (
                        <li key={t.name} className={`prompt-act${used ? " is-used" : ""}`}>
                          <button
                            type="button"
                            className="prompt-act__main"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => (used ? nextMention(t.name) : insertLine(t.title, sentence))}
                            title={used ? "Ir a donde la nombras" : `Añade: «${sentence}»`}
                          >
                            <NavIcon name={TOOL_COPY[t.name]?.icon ?? "bolt"} size={14} />
                            <span className="prompt-act__text">
                              <strong>{t.title}</strong>
                              <span className="prompt-act__meta">
                                <code>{t.name}</code>
                                <span className="prompt-act__state">
                                  {used ? (
                                    <>
                                      <NavIcon name="check" size={11} /> Ya la usas
                                    </>
                                  ) : (
                                    <>
                                      <NavIcon name="plus" size={11} /> Añadir frase
                                    </>
                                  )}
                                </span>
                              </span>
                            </span>
                          </button>
                          {used && (
                            <button
                              type="button"
                              className="prompt-act__more"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertLine(t.title, sentence)}
                              aria-label={`Añadir otra frase con «${t.title}»`}
                              title={`Añadir otra frase: «${sentence}»`}
                            >
                              <NavIcon name="plus" size={13} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="prompt-rail__hint">
                    Haz clic en el texto, en la parte donde encaje, y elige una acción: se añade una frase lista para ajustar a tu negocio. Las que ya nombras te llevan a donde aparecen.
                  </p>
                </>
              ) : (
                <p className="prompt-rail__hint">Sin acciones activadas. Se activan en «Qué puede hacer».</p>
              )}
              {offMentioned.length > 0 && (
                <p className="prompt-rail__warn">
                  <NavIcon name="alert" size={13} />
                  <span>
                    Nombras {offMentioned.map((t) => t.name).join(", ")} pero {offMentioned.length === 1 ? "está desactivada" : "están desactivadas"}: actívala en «Qué puede hacer» o quita la mención.
                  </span>
                </p>
              )}
            </section>

            <section>
              <h4>Datos de cada producto</h4>
              {!readsCatalog && (
                <p className="prompt-rail__warn" data-catalog-off>
                  <NavIcon name="alert" size={13} />
                  <span>Sin la acción «Consultar tus productos y precios» el agente no ve el catálogo: actívala en «Qué puede hacer».</span>
                </p>
              )}
              <div className="prompt-rail__list">
                {visibleData.map((f) => (
                  <DataChip
                    key={f.label}
                    field={f}
                    base={PRODUCT_BASE_FIELDS.some((b) => b.label === f.label)}
                    named={dataNamed.has(varKey(f.label))}
                    onAdd={() => insertLine(`«${f.label}»`, productDataSentence(f.label))}
                    onFind={() => nextData(f.label)}
                  />
                ))}
                {sendsImages && (
                  <button
                    type="button"
                    className={`prompt-chip prompt-chip--data${mentioned.has("send_product_image") ? " is-used" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      mentioned.has("send_product_image")
                        ? nextMention("send_product_image")
                        : insertLine("la foto", TOOL_SNIPPET.send_product_image ?? "Si el cliente quiere ver un producto, envíale la foto con send_product_image.")
                    }
                    title={mentioned.has("send_product_image") ? "Ya pides enviar la foto: clic para ir." : "Añade una frase para que envíe la foto del producto."}
                  >
                    <NavIcon name="image" size={11} /> Foto {mentioned.has("send_product_image") && <NavIcon name="check" size={11} />}
                  </button>
                )}
              </div>
              <p className="prompt-rail__hint">
                Al pulsar uno se añade una frase que le pide consultarlo con <code>search_products</code>. Escríbelos entre « », como{" "}
                <span className="pm pm-data">«Fecha de inicio»</span>: se marcan porque el agente los recibe con ese mismo nombre. No copies el valor:
                cambia y lo leería viejo.
              </p>
              {hiddenNamed.length > 0 && (
                <p className="prompt-rail__warn">
                  <NavIcon name="alert" size={13} />
                  <span>
                    Nombras {hiddenNamed.map((l) => `«${l}»`).join(", ")}, pero el agente no {hiddenNamed.length === 1 ? "lo recibe" : "los recibe"}: enciende «Lo usa el agente» en Productos › Campos.
                  </span>
                </p>
              )}
              {hiddenFields.length > 0 && (
                <p className="prompt-rail__warn">
                  <NavIcon name="alert" size={13} />
                  <span>
                    No ve {hiddenFields.map((f) => f.label).join(", ")}: {hiddenFields.length === 1 ? "tiene" : "tienen"} apagado «Lo usa el agente» en Productos › Campos.
                  </span>
                </p>
              )}
            </section>

            <section>
              <h4>Variables del contacto</h4>
              <div className="prompt-rail__list">
                {contactVars.map((v) => (
                  <button key={`v-${v.key}`} type="button" className="prompt-chip prompt-chip--var" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`{{${v.key}}}`)} title={`Se reemplaza por el dato «${v.label}» de cada cliente. Clic para insertarla.`}>
                    <NavIcon name="user" size={11} /> {v.label}
                  </button>
                ))}
              </div>
              <p className="prompt-rail__hint">
                El agente lee el dato de cada cliente: «trátalo por su nombre, {"{{nombre}}"}». Si no lo tenemos, lee «(sin dato)» y no se lo inventa.
              </p>
              {unknownVars.length > 0 && (
                <p className="prompt-rail__warn">
                  <NavIcon name="alert" size={13} />
                  <span>
                    {unknownVars.map((v) => `{{${v}}}`).join(", ")} no {unknownVars.length === 1 ? "es un dato del cliente: el agente leerá" : "son datos del cliente: el agente leerá"} «(sin dato)». Créalo como campo del contacto o quítalo.
                  </span>
                </p>
              )}
            </section>

            <section>
              <h4>Secciones{headings.length ? ` · ${headings.length}` : ""}</h4>
              {headings.length ? (
                <div className="prompt-rail__sections">
                  {headings.map((h) => (
                    <button key={h.start} type="button" onClick={() => goTo(h.start, h.end)} title="Ir a la sección">
                      {h.text}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="prompt-rail__hint">Escribe títulos en MAYÚSCULAS (TONO, QUÉ VENDES, CUÁNDO PASAR EL CHAT) y aparecerán aquí para saltar entre ellos.</p>
              )}
            </section>
          </aside>
        </div>

        <footer className="prompt-overlay__foot">
          <span>
            {words} palabra{words === 1 ? "" : "s"} · {value.length} caracteres
          </span>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            {pendingAll.length > 0 && (
              <button type="button" className="prompt-overlay__next" onClick={nextPending}>
                <NavIcon name="arrow-down" size={12} /> Siguiente por rellenar
              </button>
            )}
            <span>Esc para volver</span>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

type Caret = { start: number; end: number };
/** Algo pulsado en el panel que espera a que se elija dónde ponerlo. */
type Waiting = { what: string; run: (at: Caret) => void };

/**
 * Un dato del producto en el panel. Sin nombrar: añade una frase que pide
 * consultarlo. Ya nombrado en el texto: lo dice y lleva a donde aparece.
 */
function DataChip({
  field,
  base,
  named,
  onAdd,
  onFind,
}: {
  field: ProductDataField;
  base: boolean;
  named: boolean;
  onAdd: () => void;
  onFind: () => void;
}) {
  const hint = PRODUCT_BASE_FIELDS.find((b) => b.label === field.label)?.hint ?? "Campo propio del catálogo.";
  return (
    <button
      type="button"
      className={`prompt-chip prompt-chip--data${named ? " is-used" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={named ? onFind : onAdd}
      title={named ? `Ya nombras «${field.label}»: clic para ir.` : `${hint} Clic: añade una frase que le pide consultarlo.`}
      data-product-data={field.label}
    >
      <NavIcon name={base ? "package" : "tag"} size={11} /> {field.label}
      {named && <NavIcon name="check" size={11} />}
    </button>
  );
}

/** Una línea bajo el cuadro pequeño: qué hay dentro y un acceso a la ventana grande. */
export function PromptStatusLine({
  value,
  tools,
  vars,
  data = [],
  onOpen,
}: {
  value: string;
  tools: PromptTool[];
  vars: PromptVar[];
  /** Datos del producto que se pueden nombrar entre « ». */
  data?: ProductDataField[];
  onOpen: () => void;
}) {
  const marks = useMemo(() => collectMarks(value, tools, vars, data), [value, tools, vars, data]);
  const badVars = new Set(marks.filter((m) => m.kind === "var-off").map((m) => m.text)).size;
  const dataNamed = new Set(marks.filter((m) => m.kind === "data").map((m) => varKey(m.text))).size;
  const dataHidden = new Set(marks.filter((m) => m.kind === "data-off").map((m) => varKey(m.text))).size;
  const pending = marks.filter((m) => m.kind === "pending").length;
  const off = new Set(marks.filter((m) => m.kind === "tool-off").map((m) => m.text)).size;
  const used = new Set(marks.filter((m) => m.kind === "tool").map((m) => m.text)).size;
  const heads = findHeadings(value).length;
  const bits: React.ReactNode[] = [];
  if (pending) bits.push(<span key="p" className="prompt-status__warn">{pending} por rellenar</span>);
  if (off) bits.push(<span key="o" className="prompt-status__warn">{off} {off === 1 ? "acción desactivada nombrada" : "acciones desactivadas nombradas"}</span>);
  if (badVars) bits.push(<span key="v" className="prompt-status__warn">{badVars} {badVars === 1 ? "variable que no existe" : "variables que no existen"}</span>);
  if (dataHidden) bits.push(<span key="dh" className="prompt-status__warn">{dataHidden === 1 ? "1 dato de producto que el agente no ve" : `${dataHidden} datos de producto que el agente no ve`}</span>);
  if (used) bits.push(<span key="u">{used === 1 ? "1 acción nombrada" : `${used} acciones nombradas`}</span>);
  if (dataNamed) bits.push(<span key="d">{dataNamed === 1 ? "1 dato de producto" : `${dataNamed} datos de producto`}</span>);
  if (heads) bits.push(<span key="h">{heads === 1 ? "1 sección" : `${heads} secciones`}</span>);
  if (!value.trim()) return null;
  return (
    <div className="prompt-status" data-prompt-status>
      <span className="prompt-status__bits">
        {bits.length ? bits.map((b, i) => <span key={i}>{i > 0 && " · "}{b}</span>) : <span>Sin marcadores ni secciones</span>}
      </span>
      <button type="button" className="prompt-status__open" onClick={onOpen}>
        <NavIcon name="expand" size={12} /> Ver en grande
      </button>
    </div>
  );
}
