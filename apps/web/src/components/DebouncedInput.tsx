"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/**
 * Un campo que avisa cuando dejas de escribir (o al pulsar Intro o salir del
 * campo), no con cada letra: para búsquedas y filtros que consultan al servidor.
 * Si el valor cambia desde fuera (p. ej. «Limpiar filtros»), se pone al día.
 */
export function DebouncedInput({
  value,
  onCommit,
  delay = 350,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
  delay?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setText(value);
    }
  }, [value]);

  const commit = (v: string) => {
    if (v === committed.current) return;
    committed.current = v;
    onCommitRef.current(v);
  };

  useEffect(() => {
    if (text === committed.current) return;
    const t = setTimeout(() => commit(text), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delay]);

  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        commit(text);
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(text);
        rest.onKeyDown?.(e);
      }}
    />
  );
}
