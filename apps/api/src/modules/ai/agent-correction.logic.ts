import type { PlaygroundTurn, SimulationFinding, SimulationReviewLine } from "@crm/shared";
import { EDIT_LIMITS, EDIT_RULES, EDITS_FORMAT, parseChatCase, parseProposal, PLAYBOOK, type ProposedEdit } from "./agent-improve.logic";
import { plain } from "./simulation-review";

/**
 * Lo que no toca la base de datos ni el modelo de «Corregir al agente»: qué
 * momento del chat real se repite, el encargo a la IA que propone el cambio, la
 * comprobación de la respuesta nueva y cómo se leen las dos.
 */

// ── Qué momento se repite ────────────────────────────────────
/** De más a menos grave: si hay varios fallos, se repite la respuesta del peor. */
const SEVERITY: SimulationFinding["kind"][] = ["invented", "unanswered", "off_script", "handoff", "tone", "no_next_step"];
/** Con el comienzo de la cita basta: el revisor suele recortarla. */
const QUOTE_MATCH = 60;

/**
 * La línea del agente que hay que repetir: la que contiene la frase que marcó
 * la revisión (o, si la frase es del cliente, la respuesta que le siguió). Sin
 * frase que encontrar, la última respuesta del agente. null si no respondió a
 * nadie.
 */
export function pickMoment(lines: SimulationReviewLine[], findings: SimulationFinding[]): number | null {
  // Solo las respuestas a alguien: sin un cliente antes no hay nada que repetir.
  const firstCustomer = lines.findIndex((l) => l.who === "customer");
  const answers = lines.map((l, i) => (l.who === "agent" && firstCustomer >= 0 && i > firstCustomer && (l.text.trim() || l.handoff) ? i : -1)).filter((i) => i >= 0);
  if (!answers.length) return null;
  const bad = findings.filter((f) => f.kind !== "good").sort((a, b) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind));
  for (const f of bad) {
    const want = f.quote ? plain(f.quote.replace(/[…]+$/u, "")).slice(0, QUOTE_MATCH) : "";
    if (!want) continue;
    const said = answers.find((i) => plain(lines[i]!.text).includes(want));
    if (said !== undefined) return said;
    const asked = lines.findIndex((l) => l.who === "customer" && plain(l.text).includes(want));
    const answered = asked >= 0 ? answers.find((i) => i > asked) : undefined;
    if (answered !== undefined) return answered;
  }
  return answers[answers.length - 1]!;
}

/** El chat tal como lo tenía el agente al responder: lo hablado hasta ahí y lo último que escribió el cliente. */
export function replayInput(lines: SimulationReviewLine[], moment: number): { history: PlaygroundTurn[]; message: string; before: string } | null {
  let last = moment - 1;
  while (last >= 0 && lines[last]!.who !== "customer") last--;
  if (last < 0) return null;
  const history = lines
    .slice(0, last)
    .filter((l) => l.text.trim())
    .map((l): PlaygroundTurn => ({ role: l.who === "customer" ? "user" : "assistant", content: l.text }));
  return { history, message: lines[last]!.text, before: spoken(lines[moment]!) };
}

/** Lo que hizo el agente en una respuesta, también si fue pasar el chat. */
export function spoken(line: Pick<SimulationReviewLine, "text" | "handoff">): string {
  const handoff = line.handoff ? `(Pasó el chat a una persona: ${line.handoff})` : "";
  return [line.text.trim(), handoff].filter(Boolean).join("\n");
}

// ── El encargo ───────────────────────────────────────────────
export const CORRECTION_SYSTEM = [
  "Corriges las instrucciones de un agente de IA que atiende clientes por WhatsApp para un negocio. Te dan sus instrucciones actuales y chats REALES en los que respondió mal: lo que marcó un revisor y, si lo escribió, lo que pide el dueño.",
  "",
  "Primero decides la causa de cada chat:",
  '- "instructions": se arregla con las instrucciones (falta una regla, está mal puesta o se contradice).',
  '- "data": al agente le faltaba un dato del negocio que no está en sus instrucciones ni en lo que consultó (un precio, un horario, un requisito). Una regla no lo arregla: hay que ponerlo en el catálogo o en Conocimiento. En "note" dices qué dato falta.',
  '- "system": no depende de sus instrucciones (una consulta falló, el mensaje no salió, contestó una persona).',
  'Si el dueño pide una conducta, o escribe él mismo el dato, la causa es "instructions".',
  "",
  "Después propones como mucho 5 cambios puntuales en las instrucciones (añadir una regla, corregir una línea o quitarla) y un programa los aplica sobre el texto del dueño. No las reescribes. Si ningún chat es de instrucciones, la lista de cambios va vacía.",
  "- Lo que pide el dueño manda sobre todo lo demás. Puedes usar los datos que él escribe, tal cual.",
  "- La regla es general: sirve para cualquier cliente en esa situación. Nunca pongas nombres, teléfonos ni nada de quien escribió, ni copies su chat.",
  "- Con un solo chat casi siempre basta un cambio. No toques líneas que no causaron el fallo. No juntes en una línea dos temas distintos: cada uno, su regla en su sitio.",
  "- Nunca hagas que el agente ofrezca algo que no está escrito en sus instrucciones ni lo escribe el dueño: cuotas, descuentos, garantías, grabaciones, becas, clases gratis. Si no hay ninguna salida escrita, la regla es preguntar qué le frena y ofrecer consultarlo.",
  "- El fallo se ve en «ESTA ES LA RESPUESTA A CORREGIR». Lo que responde hoy es con las instrucciones actuales: si ya no falla ahí, no lo toques.",
  ...EDIT_RULES,
  "",
  "Guía de venta por mensajes. Es criterio para ti, no texto para copiar: úsala solo para los fallos que se ven en los chats, y con las palabras de este negocio.",
  PLAYBOOK,
  "",
  "Límites:",
  ...EDIT_LIMITS,
  "",
  "Responde solo con estos dos bloques, cada uno un JSON válido:",
  "<chats>",
  "[",
  '  {"chat": 1, "cause": "instructions, data o system", "note": "una frase sencilla para el dueño: qué pasó o qué dato falta", "missing": "el dato del negocio que le faltó para responder bien (por ejemplo, la duración del curso), o null; también si además propones una regla", "title": "de 3 a 8 palabras que distingan la situación del cliente", "brief": "de 1 a 3 frases en tercera persona, sin contar lo que hizo el agente: quién es el cliente, qué quiere y cómo reacciona. Sin nombres, teléfonos, precios ni fechas"}',
  "]",
  "</chats>",
  ...EDITS_FORMAT,
].join("\n");

/** Lo que se le pasa de cada línea y de cada chat. */
const LINE_MAX = 700;
const CHAT_MAX = 5000;
const CONSULTED_MAX = 300;

export interface CorrectionFailure {
  lines: SimulationReviewLine[];
  moment: number;
  summary: string;
  findings: SimulationFinding[];
  /** Lo que responde hoy en ese momento, si se pudo repetir. */
  today: string | null;
}

const SPEAKER: Record<string, string> = { customer: "CLIENTE", agent: "AGENTE", team: "EQUIPO", auto: "AUTOMÁTICO" };

/** El chat hasta la respuesta que se corrige (incluida), recortado por el principio si es largo. */
function talkUntil(lines: SimulationReviewLine[], moment: number): string {
  const said = lines.slice(0, moment + 1).map((l, i) => {
    const consulted = l.consulted.length ? `\n  (consultó: ${l.consulted.map((c) => c.replace(/\s+/g, " ").slice(0, CONSULTED_MAX)).join(" | ")})` : "";
    const text = (spoken(l) || "(sin mensaje)").slice(0, LINE_MAX);
    return i === moment ? `>>> ESTA ES LA RESPUESTA A CORREGIR\nAGENTE: ${text}${consulted}` : `${SPEAKER[l.who] ?? "AGENTE"}: ${text}${consulted}`;
  });
  const all = said.join("\n");
  return all.length > CHAT_MAX ? `(…)\n${all.slice(-CHAT_MAX)}` : all;
}

const FINDING_TEXT: Record<string, string> = {
  invented: "inventó un dato",
  unanswered: "no respondió",
  no_next_step: "sin siguiente paso",
  handoff: "pasar a una persona",
  tone: "forma",
  off_script: "no siguió sus instrucciones",
};

function marked(summary: string, findings: SimulationFinding[]): string {
  const notes = findings.filter((f) => f.kind !== "good").map((f) => `- [${FINDING_TEXT[f.kind] ?? f.kind}] ${f.note}${f.quote ? ` («${f.quote}»)` : ""}`);
  return [summary.trim(), ...notes].filter(Boolean).join("\n") || "(la revisión no marcó nada)";
}

/** Lo que no funcionó en el intento anterior, para que no lo repita. */
export interface PreviousAttempt {
  changes: { what: string; text: string }[];
  results: { chat: number; reply: string; note: string }[];
  /** Cambios que no se pudieron poner, y por qué. */
  rejected: string[];
}

export function correctionRequest(input: { instructions: string; note: string; chats: CorrectionFailure[]; previous?: PreviousAttempt | null }): string {
  const chats = input.chats.map((c, i) =>
    [
      `### Chat ${i + 1}`,
      `Lo que marcó el revisor:\n${marked(c.summary, c.findings)}`,
      `Conversación:\n${talkUntil(c.lines, c.moment)}`,
      c.today ? `Lo que responde hoy en ese momento: ${c.today.slice(0, LINE_MAX)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const prev = input.previous;
  return [
    `## Instrucciones actuales del agente\n${input.instructions}`,
    input.note.trim() ? `## Lo que pide el dueño (manda sobre lo demás)\n${input.note.trim()}` : "",
    `## Chats reales\n${chats.join("\n\n")}`,
    prev
      ? [
          "## Ya se intentó y no bastó",
          `Cambios que se probaron (no están puestos; propón otros, mejor colocados o más claros):\n${prev.changes.map((c) => `- ${c.what}: ${c.text}`).join("\n")}`,
          prev.results.length ? `Lo que respondió con ellos:\n${prev.results.map((r) => `- Chat ${r.chat}: ${r.reply.slice(0, LINE_MAX)} (${r.note})`).join("\n")}` : "",
          prev.rejected.length ? `No valen, y no se pudieron poner:\n${prev.rejected.map((r) => `- ${r}`).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── Leer la respuesta ────────────────────────────────────────
export type CorrectionCause = "instructions" | "data" | "system";

export interface ChatCause {
  chat: number;
  cause: CorrectionCause;
  note: string;
  /** Un dato del negocio que le faltó, aunque además haya regla. */
  missing: string | null;
  /** La situación del cliente como caso de prueba, ya sin datos personales. */
  test: { title: string; brief: string } | null;
}

/** El dato que falta, o null (los modelos a veces escriben «null» o «ninguno»). */
function lacking(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  // Solo el dato: a veces le añaden detrás lo que piensan hacer.
  return /^(?:null|ninguno|ninguna|nada|no|-)?\.?$/i.test(s) ? null : s.split(/[;\n]|\.\s/)[0]!.replace(/\.$/, "").trim().slice(0, 160) || null;
}

/** La causa de cada chat y los cambios; null si su respuesta no trae una lista de cambios que se pueda leer. */
export function parseCorrection(raw: string): { chats: ChatCause[]; edits: ProposedEdit[] } | null {
  const edits = parseProposal(raw.match(/<cambios>[\s\S]*$/i)?.[0] ?? "");
  if (!edits) return null;
  const body = raw.match(/<chats>([\s\S]*?)<\/chats>/i)?.[1] ?? "";
  const from = body.indexOf("[");
  const to = body.lastIndexOf("]");
  let list: unknown = [];
  try {
    if (from >= 0 && to > from) list = JSON.parse(body.slice(from, to + 1));
  } catch {
    list = [];
  }
  const chats = (Array.isArray(list) ? list : []).map((item): ChatCause => {
    const c = (item ?? {}) as Record<string, unknown>;
    const cause = c.cause === "data" || c.cause === "system" ? c.cause : "instructions";
    return {
      chat: Number(c.chat) || 0,
      cause,
      note: typeof c.note === "string" ? c.note.trim().slice(0, 300) : "",
      missing: lacking(c.missing),
      test: parseChatCase(JSON.stringify({ title: c.title ?? "", brief: c.brief ?? "" })),
    };
  });
  return { chats: chats.filter((c) => c.chat > 0), edits };
}

// ── Comprobar la respuesta nueva ─────────────────────────────
export const JUDGE_SYSTEM = [
  "Compruebas si una respuesta nueva de un agente de IA arregla lo que hizo mal en un chat real de WhatsApp. Te dan sus instrucciones, el chat hasta ese momento, lo que respondió entonces, lo que se marcó mal, lo que pide el dueño (si lo escribió) y la respuesta nueva con lo que consultó para darla.",
  "- fixed: true solo si la respuesta nueva ya no tiene ese fallo, contesta lo que preguntó el cliente (o dice con claridad que no lo sabe y qué hará) y, si el dueño pidió algo, lo cumple. Cambiar de tema o dar otros datos sin contestar no es arreglarlo. No la juzgues por otras cosas ni por no repetir las palabras exactas.",
  "- invented: true si afirma un precio, una fecha, un horario, un enlace, una forma de pago o una característica que no está ni en lo que consultó, ni en sus instrucciones, ni en lo que pide el dueño, ni lo dijo antes el negocio en el chat. Lo consultado puede venir recortado (termina en «…»): si el dato pudo estar ahí, no es inventado. Decir que no sabe no es inventar.",
  "- missing: el dato del negocio que preguntó el cliente y que el agente no tenía ni en lo que consultó ni en sus instrucciones (por ejemplo, la duración del curso), o null.",
  "- note: una frase corta y sencilla, para alguien que no es técnico, que diga por qué.",
  'Responde solo con JSON: {"fixed": true|false, "invented": true|false, "missing": "…" o null, "note": "…"}',
].join("\n");

/** Cuánto de las instrucciones se le pasa: como al revisor de chats. */
const JUDGE_INSTRUCTIONS_MAX = 6000;

export function judgeRequest(input: {
  instructions: string;
  lines: SimulationReviewLine[];
  moment: number;
  summary: string;
  findings: SimulationFinding[];
  note: string;
  reply: { text: string; consulted: string[]; handoff: string | null };
}): string {
  const prompt = input.instructions.trim();
  return [
    `## Instrucciones del agente${prompt.length > JUDGE_INSTRUCTIONS_MAX ? " (recortadas)" : ""}\n${prompt.slice(0, JUDGE_INSTRUCTIONS_MAX)}`,
    `## El chat hasta ese momento\n${talkUntil(input.lines, input.moment)}`,
    `## Lo que se marcó mal\n${marked(input.summary, input.findings)}`,
    input.note.trim() ? `## Lo que pide el dueño\n${input.note.trim()}` : "",
    `## Respuesta nueva\nAGENTE: ${spoken({ text: input.reply.text, handoff: input.reply.handoff }) || "(sin mensaje)"}${input.reply.consulted.length ? `\nLo que consultó para darla:\n${input.reply.consulted.map((c) => `- ${c}`).join("\n")}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseJudge(raw: string): { fixed: boolean; invented: boolean; note: string; missing: string | null } | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const p = JSON.parse(json) as { fixed?: unknown; invented?: unknown; note?: unknown; missing?: unknown };
    if (typeof p.fixed !== "boolean") return null;
    return { fixed: p.fixed, invented: p.invented === true, note: typeof p.note === "string" ? p.note.trim().slice(0, 300) : "", missing: lacking(p.missing) };
  } catch {
    return null;
  }
}
