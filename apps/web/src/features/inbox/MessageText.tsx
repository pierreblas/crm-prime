"use client";

import { Fragment } from "react";

/**
 * Renderiza el texto de un mensaje como lo hace WhatsApp.
 *
 * Antes se pintaba en un <div> pelado, así que los saltos de línea se perdían
 * (HTML colapsa los \n) y un enlace largo desbordaba la burbuja. Aquí se
 * respetan los saltos, se parten las palabras kilométricas y se interpreta el
 * formato de WhatsApp: *negrita*, _cursiva_, ~tachado~ y ```monoespaciado```.
 */

// Un enlace suelto en el texto: se hace clicable.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]}]|www\.[^\s<]+[^\s<.,:;"')\]}])/gi;

// Marcadores de WhatsApp. El orden importa: el monoespaciado va primero
// porque su contenido no debe reinterpretarse.
type Token =
  | { kind: "text"; value: string }
  | { kind: "mono"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "strike"; value: string }
  | { kind: "link"; value: string };

const PATTERNS: { kind: Token["kind"]; re: RegExp }[] = [
  { kind: "mono", re: /```([\s\S]+?)```/ },
  { kind: "bold", re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/ },
  { kind: "italic", re: /(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/ },
  { kind: "strike", re: /(?<![\w~])~(?!\s)([^~\n]+?)(?<!\s)~(?![\w~])/ },
];

function tokenize(input: string): Token[] {
  // Se busca el marcador que aparezca ANTES en el texto, no el primero de la
  // lista: si no, "_cursiva_ y *negrita*" se partiría al revés.
  let earliest: { kind: Token["kind"]; index: number; match: RegExpMatchArray } | null =
    null;
  for (const { kind, re } of PATTERNS) {
    const m = input.match(re);
    if (m?.index !== undefined && (!earliest || m.index < earliest.index)) {
      earliest = { kind, index: m.index, match: m };
    }
  }

  if (!earliest) return linkify(input);

  const { kind, index, match } = earliest;
  return [
    ...tokenize(input.slice(0, index)),
    { kind, value: match[1] ?? "" },
    ...tokenize(input.slice(index + match[0].length)),
  ];
}

function linkify(input: string): Token[] {
  if (!input) return [];
  const out: Token[] = [];
  let last = 0;
  for (const m of input.matchAll(URL_RE)) {
    if (m.index === undefined) continue;
    if (m.index > last) {
      out.push({ kind: "text", value: input.slice(last, m.index) });
    }
    out.push({ kind: "link", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ kind: "text", value: input.slice(last) });
  return out;
}

export function MessageText({
  text,
  highlight,
}: {
  text: string;
  /** Término del buscador: se marca dentro del texto ya formateado. */
  highlight?: string | null;
}) {
  return (
    <div style={body}>
      {tokenize(text).map((t, i) => (
        <Fragment key={i}>{render(t, highlight)}</Fragment>
      ))}
    </div>
  );
}

// Parte un texto plano por el término buscado y marca las coincidencias.
function mark(value: string, term: string | null | undefined): React.ReactNode {
  if (!term) return value;
  const i = value.toLowerCase().indexOf(term.toLowerCase());
  if (i === -1) return value;
  return (
    <>
      {value.slice(0, i)}
      <mark style={hit}>{value.slice(i, i + term.length)}</mark>
      {mark(value.slice(i + term.length), term)}
    </>
  );
}

const hit: React.CSSProperties = {
  background: "rgba(240, 180, 90, 0.35)",
  color: "inherit",
  borderRadius: 3,
  padding: "0 1px",
};

function render(t: Token, highlight?: string | null): React.ReactNode {
  switch (t.kind) {
    case "bold":
      return <strong>{mark(t.value, highlight)}</strong>;
    case "italic":
      return <em>{mark(t.value, highlight)}</em>;
    case "strike":
      return <s>{mark(t.value, highlight)}</s>;
    case "mono":
      return <code style={mono}>{t.value}</code>;
    case "link":
      return (
        <a
          href={t.value.startsWith("www.") ? `https://${t.value}` : t.value}
          target="_blank"
          rel="noopener noreferrer"
          style={link}
        >
          {t.value}
        </a>
      );
    default:
      return mark(t.value, highlight);
  }
}

const body: React.CSSProperties = {
  // pre-wrap conserva los saltos de línea y los espacios del original.
  whiteSpace: "pre-wrap",
  // "anywhere" parte URLs y palabras larguísimas en vez de desbordar.
  overflowWrap: "anywhere",
  lineHeight: 1.45,
};

const mono: React.CSSProperties = {
  display: "block",
  background: "var(--surface-2)",
  borderRadius: 6,
  padding: "6px 8px",
  margin: "3px 0",
  fontSize: 12.5,
  whiteSpace: "pre-wrap",
  overflowX: "auto",
};

const link: React.CSSProperties = {
  color: "var(--accent-text)",
  textDecoration: "underline",
};
