"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "@/components/NavIcons";
import { smBtn } from "@/components/ui";
import { ghostBtn } from "./styles";
import { collectMarks, findHeadings, pendingSummary, segments, type Mark, type PromptTool } from "./promptMarks";

/**
 * «Cómo debe atender» a pantalla grande. El mismo texto, con sitio para
 * leerlo entero, y lo que importa señalado encima: marcadores por rellenar,
 * acciones del agente (y si están activadas) y títulos de sección. El panel
 * de la derecha lista esos elementos: un clic lleva al sitio o lo inserta.
 *
 * El resaltado es una capa con el mismo texto debajo de un textarea con la
 * tinta transparente: la escritura sigue siendo la de siempre.
 */
export function PromptOverlay({
  value,
  onChange,
  onClose,
  onAssist,
  tools,
  catalogFields,
  contactFields,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onAssist: () => void;
  tools: PromptTool[];
  catalogFields: string[];
  contactFields: { key: string; label: string }[];
}) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const backdrop = useRef<HTMLDivElement | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    const el = ta.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const marks = useMemo(() => collectMarks(value, tools), [value, tools]);
  const parts = useMemo(() => segments(value, marks), [value, marks]);
  const pending = useMemo(() => pendingSummary(marks), [marks]);
  const pendingAll = useMemo(() => marks.filter((m) => m.kind === "pending"), [marks]);
  const headings = useMemo(() => findHeadings(value), [value]);
  const mentioned = useMemo(() => new Set(marks.filter((m) => m.kind === "tool" || m.kind === "tool-off").map((m) => m.text)), [marks]);
  const offMentioned = tools.filter((t) => !t.enabled && mentioned.has(t.name));
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
    t.focus();
    t.setSelectionRange(start, end);
    setRailOpen(false);
  }, []);

  /** Inserta un texto donde está el cursor (con espacio delante si hace falta). */
  const insert = useCallback(
    (token: string) => {
      const t = ta.current;
      const s = t?.selectionStart ?? value.length;
      const e = t?.selectionEnd ?? value.length;
      const before = value.slice(0, s);
      const pad = before && !/\s$/.test(before) ? " " : "";
      const next = `${before}${pad}${token}${value.slice(e)}`;
      onChange(next);
      const caret = s + pad.length + token.length;
      requestAnimationFrame(() => {
        t?.focus();
        t?.setSelectionRange(caret, caret);
      });
      setRailOpen(false);
    },
    [value, onChange],
  );

  const nextPending = useCallback(() => {
    if (!pendingAll.length) return;
    const from = ta.current?.selectionEnd ?? 0;
    const m = pendingAll.find((p) => p.start >= from) ?? pendingAll[0]!;
    goTo(m.start, m.end);
  }, [pendingAll, goTo]);

  const enabledTools = tools.filter((t) => t.enabled);
  const railCount = pending.length + offMentioned.length;

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
          <div className="prompt-editor">
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
              onChange={(e) => onChange(e.target.value)}
              onScroll={syncScroll}
              aria-label="Cómo debe atender, en grande"
              spellCheck
            />
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
                  <div className="prompt-rail__list">
                    {enabledTools.map((t) => (
                      <button key={t.name} type="button" className={`prompt-chip prompt-chip--tool${mentioned.has(t.name) ? " is-used" : ""}`} onClick={() => insert(t.name)} title={`${t.title}. Clic para insertar el nombre donde está el cursor.`}>
                        {mentioned.has(t.name) && <NavIcon name="check" size={11} />}
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <p className="prompt-rail__hint">Nómbralas así para que la IA las use en un caso concreto. Con ✓, ya las nombras.</p>
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
              <h4>Datos que ya conoce</h4>
              {catalogFields.length || contactFields.length ? (
                <>
                  <div className="prompt-rail__list">
                    {catalogFields.map((f) => (
                      <button key={`c-${f}`} type="button" className="prompt-chip" onClick={() => insert(f)} title="Dato de cada producto del catálogo. Clic para insertarlo.">
                        <NavIcon name="tag" size={11} /> {f}
                      </button>
                    ))}
                    {contactFields.map((f) => (
                      <button key={`k-${f.key}`} type="button" className="prompt-chip" onClick={() => insert(f.label)} title="Dato guardado del contacto. Clic para insertarlo.">
                        <NavIcon name="user" size={11} /> {f.label}
                      </button>
                    ))}
                  </div>
                  <p className="prompt-rail__hint">Los lee solo: pídele que los consulte y los cite («consulta el temario y cítalo»).</p>
                </>
              ) : (
                <p className="prompt-rail__hint">Nombre, precio y descripción de cada producto, y la ficha del contacto. Los campos propios aparecerán aquí.</p>
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

/** Una línea bajo el cuadro pequeño: qué hay dentro y un acceso a la ventana grande. */
export function PromptStatusLine({ value, tools, onOpen }: { value: string; tools: PromptTool[]; onOpen: () => void }) {
  const marks = useMemo(() => collectMarks(value, tools), [value, tools]);
  const pending = marks.filter((m) => m.kind === "pending").length;
  const off = new Set(marks.filter((m) => m.kind === "tool-off").map((m) => m.text)).size;
  const used = new Set(marks.filter((m) => m.kind === "tool").map((m) => m.text)).size;
  const heads = findHeadings(value).length;
  const bits: React.ReactNode[] = [];
  if (pending) bits.push(<span key="p" className="prompt-status__warn">{pending} por rellenar</span>);
  if (off) bits.push(<span key="o" className="prompt-status__warn">{off} {off === 1 ? "acción desactivada nombrada" : "acciones desactivadas nombradas"}</span>);
  if (used) bits.push(<span key="u">{used === 1 ? "1 acción nombrada" : `${used} acciones nombradas`}</span>);
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
