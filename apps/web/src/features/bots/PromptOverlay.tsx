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
  // Dónde dejó el cursor la persona (null = aún no hizo clic en el texto). Las
  // acciones y datos del panel se insertan ahí, nunca «al final» por defecto.
  const caret = useRef<{ start: number; end: number } | null>(null);
  const [needCaret, setNeedCaret] = useState(false);
  // Lo recién insertado se ilumina un momento para que se vea dónde quedó.
  const [flash, setFlash] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    // Abre arriba del todo, sin mover la vista al final del texto.
    ta.current?.focus({ preventScroll: true });
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
    setNeedCaret(false);
    setRailOpen(false);
  }, []);

  const rememberCaret = useCallback(() => {
    const t = ta.current;
    if (!t || document.activeElement !== t) return;
    caret.current = { start: t.selectionStart, end: t.selectionEnd };
    setNeedCaret(false);
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

  /** Inserta un texto donde la persona dejó el cursor (con espacios alrededor si hace falta). */
  const insert = useCallback(
    (token: string) => {
      const t = ta.current;
      const at = caret.current;
      if (!t || !at) {
        // Sin sitio elegido no se adivina: se pide, y el cuadro se señala.
        setNeedCaret(true);
        setRailOpen(false);
        return;
      }
      const before = value.slice(0, at.start);
      const after = value.slice(at.end);
      const padL = before && !/\s$/.test(before) ? " " : "";
      const padR = after && !/^[\s.,;:)»]/.test(after) ? " " : "";
      onChange(`${before}${padL}${token}${padR}${after}`);
      const start = at.start + padL.length;
      const end = start + token.length;
      const next = end + padR.length;
      caret.current = { start: next, end: next };
      setFlash({ start, end });
      setRailOpen(false);
      // Tras pintar el texto nuevo: cursor detrás de lo insertado y vista centrada en ello.
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
    [value, onChange, reveal],
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
          <div className={`prompt-editor${needCaret ? " is-asking" : ""}`}>
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
              onKeyUp={rememberCaret}
              onMouseUp={rememberCaret}
              onInput={rememberCaret}
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
              {needCaret && (
                <p className="prompt-rail__ask" role="status">
                  <NavIcon name="target" size={13} />
                  <span>Primero haz clic en el texto, justo donde quieres que vaya, y vuelve a pulsar.</span>
                </p>
              )}
              {enabledTools.length ? (
                <>
                  <div className="prompt-rail__list">
                    {enabledTools.map((t) => (
                      <button key={t.name} type="button" className={`prompt-chip prompt-chip--tool${mentioned.has(t.name) ? " is-used" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t.name)} title={`${t.title}. Clic para insertar el nombre donde está el cursor.`}>
                        {mentioned.has(t.name) && <NavIcon name="check" size={11} />}
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <p className="prompt-rail__hint">Haz clic en el texto donde quieras nombrarla y luego en la acción. Con ✓, ya la nombras.</p>
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
                      <button key={`c-${f}`} type="button" className="prompt-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f)} title="Dato de cada producto del catálogo. Clic para insertarlo.">
                        <NavIcon name="tag" size={11} /> {f}
                      </button>
                    ))}
                    {contactFields.map((f) => (
                      <button key={`k-${f.key}`} type="button" className="prompt-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f.label)} title="Dato guardado del contacto. Clic para insertarlo.">
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
