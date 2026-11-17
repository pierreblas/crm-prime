"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fillContactText, varKey, varsIn, type ContactVarValues } from "@crm/shared";
import type { PromptVar } from "./promptMarks";

/**
 * Un mensaje fijo que lee el cliente (saludo, fuera de horario, respuestas
 * por palabra clave, aviso al pasar el chat, seguimientos), con sus datos:
 *
 *  - «Insertar dato del cliente» pone {{nombre}} donde está el cursor;
 *  - al escribir «{{» aparece la lista y se elige con las flechas;
 *  - debajo, cómo le llega a un cliente de ejemplo y a uno del que no sabemos
 *    nada (la variable se quita y la frase se arregla, como al enviar).
 */

type Menu = { mode: "button" } | { mode: "typing"; from: number; query: string };

const SAMPLE: ContactVarValues = { nombre: "Ana", telefono: "+51 987 654 321", pais: "Perú", moneda: "PEN" };
// Lo rellenado en la vista previa va entre estas dos marcas para pintarlo aparte.
const OPEN = "\u0001";
const CLOSE = "\u0002";

export function VarTextarea({
  value,
  onChange,
  vars,
  placeholder,
  maxLength,
  minHeight = 60,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  vars: PromptVar[];
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  ariaLabel?: string;
  /** Lo que va a la derecha de «Insertar dato del cliente» (contador, asistente…). */
  children?: React.ReactNode;
}) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();

  const options = useMemo(() => {
    if (menu?.mode !== "typing" || !menu.query) return vars;
    const q = varKey(menu.query);
    return vars.filter((v) => varKey(v.key).includes(q) || varKey(v.label).includes(q));
  }, [menu, vars]);
  useEffect(() => setActive(0), [menu?.mode, options.length]);

  /** ¿Está escribiendo «{{algo» justo antes del cursor? */
  function watchTyping(el: HTMLTextAreaElement) {
    if (el.selectionStart !== el.selectionEnd) return setMenu(null);
    const upto = el.value.slice(0, el.selectionStart);
    const hit = /\{\{\s*([^{}\n|]{0,30})$/.exec(upto);
    setMenu(hit ? { mode: "typing", from: hit.index, query: hit[1]!.trim() } : null);
  }

  function choose(v: PromptVar) {
    const el = ta.current;
    const token = `{{${v.key}}}`;
    let start = el?.selectionStart ?? value.length;
    let end = el?.selectionEnd ?? value.length;
    let pad = "";
    if (menu?.mode === "typing") {
      start = menu.from;
    } else if (start > 0 && /[\p{L}\p{N}]/u.test(value[start - 1]!)) {
      // «Hola» + {{nombre}} → «Hola {{nombre}}»
      pad = " ";
    }
    const next = `${value.slice(0, start)}${pad}${token}${value.slice(end)}`;
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    setMenu(null);
    const caret = start + pad.length + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!menu || !options.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === "Escape") {
      // Cierra la lista, no la ventana en la que está el cuadro.
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    }
  }

  const open = !!menu && options.length > 0;

  return (
    <div className="var-field">
      <div className="var-field__box">
        <textarea
          ref={ta}
          className="field"
          style={{ minHeight, resize: "vertical", fontFamily: "inherit" }}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          onChange={(e) => {
            onChange(e.target.value);
            watchTyping(e.target);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => watchTyping(e.currentTarget)}
          onBlur={() => setMenu(null)}
        />
        {open && (
          <ul className="var-menu" id={listId} role="listbox" aria-label="Datos del cliente">
            {options.map((v, i) => (
              <li key={v.key} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={i === active ? "is-active" : undefined}
                  // Sin perder el foco del cuadro: así se sabe dónde va.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(v)}
                >
                  <span>{v.label}</span>
                  <code>{`{{${v.key}}}`}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="var-field__bar">
        <button
          type="button"
          className="var-field__insert"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            ta.current?.focus();
            setMenu((m) => (m?.mode === "button" ? null : { mode: "button" }));
          }}
          aria-expanded={menu?.mode === "button"}
          title="También puedes escribir {{ en el texto"
        >
          <span aria-hidden="true">{"{ }"}</span> Insertar dato del cliente
        </button>
        <span className="var-field__extra">{children}</span>
      </div>
      <VarPreview text={value} vars={vars} />
    </div>
  );
}

/** Cómo le llega el mensaje: a un cliente de ejemplo y a uno del que no sabemos nada. */
export function VarPreview({ text, vars }: { text: string; vars: PromptVar[] }) {
  const used = varsIn(text);
  if (!used.length) return null;
  const known = new Set(vars.flatMap((v) => [varKey(v.key), varKey(v.label)]));
  const unknown = used.filter((n) => !known.has(varKey(n)));
  // Los campos propios no tienen un valor de ejemplo creíble: se ve su nombre.
  const sample: ContactVarValues = {};
  for (const v of vars) sample[varKey(v.key)] = sample[varKey(v.label)] = SAMPLE[varKey(v.key)] ?? v.label;
  const marked: ContactVarValues = Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, `${OPEN}${v}${CLOSE}`]));
  const full = fillContactText(text, marked).trim();
  const bare = fillContactText(text, {}).trim();
  const onlyName = used.every((n) => varKey(n) === "nombre");
  return (
    <div className="var-preview" aria-live="polite">
      <div className="var-preview__row">
        <span className="var-preview__label">Así le llega a Ana</span>
        <p>{paint(full)}</p>
      </div>
      <div className="var-preview__row">
        <span className="var-preview__label">{onlyName ? "Si no sabemos su nombre" : "Si falta algún dato"}</span>
        <p>{bare || <em>No se envía nada: el mensaje solo tiene datos del cliente.</em>}</p>
      </div>
      {unknown.length > 0 && (
        <p className="var-preview__warn">
          {unknown.map((n) => `{{${n}}}`).join(", ")} no {unknown.length === 1 ? "es un dato del cliente: se quitará" : "son datos del cliente: se quitarán"} al enviar. Créalo como campo del contacto o elige uno de la lista.
        </p>
      )}
    </div>
  );
}

function paint(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest) {
    const a = rest.indexOf(OPEN);
    if (a < 0) {
      out.push(rest);
      break;
    }
    const b = rest.indexOf(CLOSE, a);
    if (a > 0) out.push(rest.slice(0, a));
    out.push(<mark key={i++}>{rest.slice(a + 1, b < 0 ? undefined : b)}</mark>);
    rest = b < 0 ? "" : rest.slice(b + 1);
  }
  return out;
}
