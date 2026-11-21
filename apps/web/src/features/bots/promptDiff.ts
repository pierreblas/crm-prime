export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** A partir de aquí la tabla de comparación pesa demasiado para el navegador: se enseña todo como quitado y añadido. */
const MAX_CELLS = 4_000_000;

/**
 * Lo que cambia entre dos versiones de las instrucciones, línea a línea: la
 * subsecuencia común más larga se queda como «igual», lo demás es quitado (de
 * la anterior) o añadido (en la nueva). Sin React ni DOM.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.replace(/\r\n/g, "\n").split("\n") : [];
  const b = after ? after.replace(/\r\n/g, "\n").split("\n") : [];
  const all = (lines: string[], kind: DiffLine["kind"]): DiffLine[] => lines.map((text) => ({ kind, text }));
  if (a.length * b.length > MAX_CELLS) return [...all(a, "removed"), ...all(b, "added")];

  // lcs[i][j]: líneas en común entre a[i…] y b[j…].
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      out.push({ kind: "removed", text: a[i++]! });
    } else {
      out.push({ kind: "added", text: b[j++]! });
    }
  }
  return [...out, ...all(a.slice(i), "removed"), ...all(b.slice(j), "added")];
}
