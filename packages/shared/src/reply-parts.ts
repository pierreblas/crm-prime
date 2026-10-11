/**
 * Partir una respuesta larga en varios mensajes cortos, como escribe una
 * persona por WhatsApp: primero por párrafos (línea en blanco), y si uno sigue
 * siendo largo, por frases. Las listas (líneas que empiezan por «-», «•» o
 * «1.») se quedan con su párrafo. Nunca más de `maxParts` mensajes: el resto
 * se junta en el último.
 */
export interface SplitReplyOptions {
  /** Máximo de mensajes. */
  maxParts?: number;
  /** A partir de cuántos caracteres un párrafo se parte por frases. */
  maxChars?: number;
}

const DEFAULTS: Required<SplitReplyOptions> = { maxParts: 4, maxChars: 320 };

/** Solo por párrafos (línea en blanco): para textos escritos a mano, donde el corte lo decide quien escribe. */
export function splitParagraphs(text: string, maxParts = DEFAULTS.maxParts): string[] {
  const parts = text
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return capParts(parts, maxParts);
}

/** Por párrafos y, dentro de un párrafo largo, por frases. */
export function splitReply(text: string, opts: SplitReplyOptions = {}): string[] {
  const { maxParts, maxChars } = { ...DEFAULTS, ...opts };
  const paragraphs = splitParagraphs(text, Number.MAX_SAFE_INTEGER);
  const parts: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars || isList(p)) {
      parts.push(p);
      continue;
    }
    let current = "";
    for (const sentence of sentences(p)) {
      if (current && current.length + 1 + sentence.length > maxChars) {
        parts.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) parts.push(current);
  }
  // Un trozo minúsculo suelto («¡Claro!») se pega al siguiente para no mandar migajas.
  const merged: string[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length < 25) merged[merged.length - 1] = `${last}\n\n${part}`;
    else merged.push(part);
  }
  return capParts(merged, maxParts);
}

/** Pausa realista antes de enviar un trozo: lo que tardaría en escribirse, con tope. */
export function typingPauseMs(part: string): number {
  return Math.min(6000, 900 + part.length * 35);
}

function capParts(parts: string[], maxParts: number): string[] {
  if (parts.length <= maxParts) return parts;
  const head = parts.slice(0, maxParts - 1);
  const tail = parts.slice(maxParts - 1).join("\n\n");
  return [...head, tail];
}

function isList(p: string): boolean {
  const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 && lines.filter((l) => /^([-•*]|\d+[.)])\s/.test(l)).length >= lines.length - 1;
}

function sentences(p: string): string[] {
  // Corta tras . ! ? … seguidos de espacio, y en saltos de línea simples.
  return p
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
