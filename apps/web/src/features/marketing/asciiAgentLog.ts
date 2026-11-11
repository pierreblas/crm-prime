/**
 * El registro del agente en el hero: un terminal ASCII que narra, línea a
 * línea, lo que hace un agente de Driony en tres escenas que se repiten
 * (atiende y agenda, lee un comprobante y cobra, retoma al que se enfrió).
 *
 * Sigue el formato de pieza de ascii.rest (`meta` + `default(options)` que
 * devuelve `(t) => texto`), así se puede probar con sus herramientas
 * (`npx ascii.rest play apps/web/src/features/marketing/asciiAgentLog.ts`),
 * pero la pieza es nuestra: el contenido es el argumento del hero, no un
 * adorno. Cada fotograma depende solo de `t`: mismo texto en servidor y en
 * el navegador.
 */
export const meta = {
  name: "driony agent log",
  category: "ui" as const,
  note: "a sales agent reads, replies, books and hands over, in three scenes",
  cols: 46,
  rows: 5,
  fps: 20,
  options: {} as Record<string, never>,
  /** Para quien prefiere menos movimiento: la primera escena escrita entera. */
  still: 0,
};

type Who = "cliente" | "agente";
type Line = [Who, string];

/** Tres escenas, cinco líneas cada una (las filas del terminal). */
const SCENES: Line[][] = [
  [
    ["cliente", "¿tienen cupo el sábado?"],
    ["agente", "lee el catálogo ......... ok"],
    ["agente", "responde: 2 cupos, 10:00 y 16:00"],
    ["agente", "agenda demo → Interesado"],
    ["agente", "avisa a tu vendedor"],
  ],
  [
    ["cliente", "[imagen] comprobante.jpg"],
    ["agente", "lee el comprobante ...... ok"],
    ["agente", "registra el pago: S/ 180"],
    ["agente", "mueve a Ganado"],
    ["agente", "confirma por WhatsApp"],
  ],
  [
    ["cliente", "(sin respuesta 48 h)"],
    ["agente", "retoma: ¿seguimos con la demo?"],
    ["cliente", "sí, mañana a las 4"],
    ["agente", "agenda: demo mañana 16:00"],
    ["agente", "avisa a tu vendedor"],
  ],
];

const CURSOR = "▌";
/** Segundos por carácter: el agente teclea, el cliente pega. */
const TYPE = { agente: 0.03, cliente: 0.018 };
const AFTER_LINE = 0.4;
const AFTER_SCENE = 3.2;
const BLINK = 0.5;

function prefix(who: Who): string {
  return (who === "cliente" ? "> " : "  ") + who.padEnd(8);
}

/** La escena entera como lista de [instante, filas escritas hasta ahí], tendida una vez. */
function layout(): { events: Array<[number, string[]]>; total: number; still: number } {
  const events: Array<[number, string[]]> = [];
  let at = 0;
  let still = 0;
  for (const [s, scene] of SCENES.entries()) {
    const rows: string[] = [];
    events.push([at, []]);
    for (const [who, text] of scene) {
      const head = prefix(who);
      rows.push(head);
      for (let i = 1; i <= text.length; i++) {
        at += TYPE[who] + (text[i - 1] === " " ? 0.02 : 0) + (text[i - 1] === "." ? 0.04 : 0);
        rows[rows.length - 1] = head + text.slice(0, i);
        events.push([at, [...rows]]);
      }
      at += AFTER_LINE;
    }
    if (s === 0) still = at;
    at += AFTER_SCENE;
  }
  return { events, total: at, still };
}

const LAID = layout();
meta.still = LAID.still;

export default function agentLog(): (t: number) => string {
  const { cols, rows } = meta;
  const { events, total } = LAID;
  return (t: number) => {
    const tt = ((t % total) + total) % total;
    // La última entrada cuyo instante ya pasó (están en orden).
    let lo = 0;
    let hi = events.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (events[mid]![0] <= tt) lo = mid;
      else hi = mid - 1;
    }
    const lines = [...events[lo]![1]];
    const blink = Math.floor(tt / BLINK) % 2 === 0;
    if (lines.length === 0) lines.push(blink ? CURSOR : "");
    else if (blink) lines[lines.length - 1] += CURSOR;
    const out: string[] = [];
    for (let r = 0; r < rows; r++) out.push((lines[r] ?? "").slice(0, cols).padEnd(cols));
    return out.join("\n");
  };
}
