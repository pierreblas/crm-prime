"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Deshacer y rehacer propios para un texto largo editado en varios sitios (el
 * cuadro pequeño y la ventana grande de «Cómo debe atender»).
 *
 * Existe porque el deshacer del navegador no sirve aquí: se pierde cuando el
 * texto cambia por código (insertar una acción desde el panel, aplicar lo que
 * redactó el asistente) y cada textarea tiene el suyo, así que lo escrito en la
 * ventana grande no se deshacía en la pequeña ni al revés.
 *
 * Lo tecleado seguido se agrupa (una pausa de más de un segundo corta el
 * grupo); cualquier otro cambio es un paso propio.
 */
const GROUP_MS = 1000;
const MAX_STEPS = 200;

export type TextChangeKind = "type" | "edit";

export interface TextHistory {
  /** Cambia el texto dejando el paso en el historial. */
  change: (next: string, kind?: TextChangeKind) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Para el onKeyDown de los textarea: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z y Ctrl/⌘+Y. */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Dónde dejar el cursor tras deshacer: al final del tramo que cambió. */
export function changedCaret(before: string, after: string): number {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return after.length - tail;
}

export function useTextHistory(value: string, onChange: (v: string) => void): TextHistory {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastTyped = useRef(0);
  const current = useRef(value);
  current.current = value;
  // Solo para repintar los botones de deshacer y rehacer.
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const change = useCallback(
    (next: string, kind: TextChangeKind = "edit") => {
      const prev = current.current;
      if (next === prev) return;
      const now = Date.now();
      const grouped = kind === "type" && now - lastTyped.current < GROUP_MS && past.current.length > 0;
      if (!grouped) {
        past.current.push(prev);
        if (past.current.length > MAX_STEPS) past.current.shift();
      }
      lastTyped.current = kind === "type" ? now : 0;
      future.current = [];
      current.current = next;
      onChange(next);
      bump();
    },
    [onChange],
  );

  const step = useCallback(
    (from: string[], to: string[], el?: HTMLTextAreaElement | null) => {
      const target = from.pop();
      if (target === undefined) return;
      const prev = current.current;
      to.push(prev);
      lastTyped.current = 0;
      current.current = target;
      onChange(target);
      bump();
      if (el) {
        const caret = changedCaret(prev, target);
        // Tras pintar el texto restaurado.
        requestAnimationFrame(() => el.setSelectionRange(caret, caret));
      }
    },
    [onChange],
  );

  const undo = useCallback(() => step(past.current, future.current), [step]);
  const redo = useCallback(() => step(future.current, past.current), [step]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        step(past.current, future.current, e.currentTarget);
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        step(future.current, past.current, e.currentTarget);
      }
    },
    [step],
  );

  return {
    change,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    onKeyDown,
  };
}
