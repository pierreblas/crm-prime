import {
  REPLY_BUTTONS_TOOL,
  type ImproveChange,
  type ImproveScore,
  type PlaygroundReply,
  type SimulationFinding,
  type SimulationReviewLine,
} from "@crm/shared";

/**
 * Lo que no toca la base de datos ni el modelo de «Mejorar agente»: cómo se le
 * pasa una conversación simulada al revisor, el encargo a la IA que propone
 * cambios en las instrucciones, cómo se lee su respuesta y qué se le exige a
 * una propuesta antes de enseñársela al dueño.
 */

// ── La conversación simulada, para el revisor ────────────────
/** La respuesta del agente en la prueba como la lee el revisor: lo que dijo y lo que consultó para decirlo. */
export function improveLine(agent: PlaygroundReply): SimulationReviewLine {
  const consulted = [
    ...(agent.toolCalls ?? [])
      .filter((c) => c.name !== REPLY_BUTTONS_TOOL)
      .map((c) => `${c.name}${c.input ? ` ${c.input}` : ""} → ${c.summary}${c.evidence ? `\nDevolvió: ${c.evidence}` : ""}`.slice(0, 2000)),
    ...(agent.simulatedActions ?? []).map((a) => `Acción (no aplicada en la prueba): ${a}`.slice(0, 2000)),
  ].slice(0, 12);
  return {
    who: "agent",
    text: (agent.reply ?? "").slice(0, 4000),
    consulted,
    options: (agent.options ?? []).slice(0, 10).map((o) => o.slice(0, 40)),
    handoff: agent.escalate ? (agent.escalationReason ?? "sin motivo").slice(0, 400) : null,
  };
}

// ── El encargo a la IA que propone ───────────────────────────
/**
 * Buenas prácticas de venta por mensajes. Son de conducta, no del negocio: la
 * propuesta puede añadirlas como reglas, pero nunca un precio ni una promesa.
 */
const PLAYBOOK = [
  "- Responde primero lo que el cliente preguntó, con el dato concreto; después lo demás.",
  "- Mensajes cortos, como en WhatsApp. Una pregunta por mensaje, nunca dos seguidas.",
  "- Cada mensaje termina proponiendo el siguiente paso (reservar, pagar, agendar, elegir), sin repetir el mismo cierre dos veces seguidas.",
  "- No repitas una presentación que ya enviaste: responde solo lo nuevo.",
  "- Ante una objeción (caro, sin tiempo, lo pienso): reconoce, da UN motivo o UNA salida que exista en las instrucciones (cuotas, grabaciones, garantía) y vuelve a proponer el paso. Sin presionar ni insistir más de una vez.",
  "- Urgencia y escasez solo si son reales y constan (una oferta con fecha, cupos que trae el catálogo). Nunca inventadas.",
  "- Si el cliente cuenta algo de sí mismo, conecta el producto con eso en una línea.",
  "- Lo que no sabe: lo dice sin rodeos y hace lo que mande el negocio (consultarlo, pasar a una persona). Nunca lo inventa ni lo esquiva con un cierre.",
  "- Pasa a una persona cuando lo piden, cuando el cliente está molesto o cuando hay dinero ya pagado de por medio; no por cualquier duda.",
].join("\n");

/** Cambios por propuesta, como mucho, y lo que puede medir el texto de cada uno. */
const EDITS_MAX = 6;
const EDIT_TEXT_MAX = 500;

/**
 * El encargo. La IA no reescribe las instrucciones: propone cambios puntuales
 * y `applyProposal` los coloca. Así lo que el dueño escribió (precios, fechas,
 * tono) no pasa por el modelo, y la lista de cambios es exactamente lo que
 * cambia.
 */
export const PROPOSAL_SYSTEM = [
  "Mejoras las instrucciones de un agente de IA que atiende clientes por WhatsApp para un negocio. Te dan sus instrucciones actuales y conversaciones simuladas que salieron mal, con lo que marcó un revisor.",
  "",
  `No reescribes las instrucciones. Propones como mucho ${EDITS_MAX - 1} cambios puntuales (añadir una regla, corregir una línea o quitarla) y un programa los aplica sobre el texto del dueño. Cada cambio corrige un fallo que se ve en las conversaciones.`,
  "",
  "Cómo decides los cambios:",
  "- Parte de lo que marcó el revisor. Para cada fallo, busca la línea de las instrucciones que lo provoca (corrígela o quítala) o la regla que falta (añádela).",
  "- Una regla nueva es una orden concreta para el agente, en una o dos líneas, escrita como las demás líneas de esas instrucciones: mismo tono, mismo formato, mismas viñetas.",
  "- Si dos fallos se arreglan con la misma regla, es un solo cambio. Menos cambios y mejor puestos valen más que muchos.",
  "- Si una línea de las instrucciones empuja al fallo (por ejemplo, pide respuestas largas y el fallo es que escribe demasiado), corrige esa línea en vez de añadir otra que la contradiga.",
  "- Pon cada regla nueva en la sección de las instrucciones donde corresponde (junto a las reglas de cómo atender, no entre los datos del negocio).",
  "",
  "Guía de venta por mensajes. Es criterio para ti, no texto para copiar: úsala solo para los fallos que se ven en las conversaciones, y con las palabras de este negocio.",
  PLAYBOOK,
  "",
  "Límites:",
  "- Nunca añadas datos del negocio que no estén ya en las instrucciones: precios, fechas, horarios, plazos, descuentos, garantías, formas de pago, políticas, nombres. Si falta un dato, la regla dice qué hacer cuando no se sabe; no lo inventes.",
  "- No toques los datos entre « » (como «Precio»), los huecos entre corchetes (como [Oferta]) ni los nombres de las herramientas (como search_products).",
  "- No cambies lo que funciona ni el tono del dueño.",
  "",
  "Responde solo con este bloque, un JSON válido:",
  "<cambios>",
  "[",
  "  {",
  '    "what": "qué cambia, en una frase sencilla para el dueño del negocio, que no es técnico",',
  '    "why": "qué fallaba en las conversaciones, en una frase",',
  '    "case": "el título del caso que lo motivó, o null",',
  '    "action": "add, replace o remove",',
  '    "anchor": "una línea copiada EXACTA de las instrucciones actuales. Con add: la última línea de la sección donde va la regla nueva (vacío solo si las instrucciones no tienen secciones). Con replace y remove: la línea que se cambia o se quita",',
  '    "text": "con add y replace: la línea o líneas nuevas, tal como deben quedar escritas en las instrucciones; como mucho dos líneas cortas (unos 300 caracteres)"',
  "  }",
  "]",
  "</cambios>",
].join("\n");

const VERDICT_TEXT: Record<string, string> = { ok: "bien", review: "revisar", bad: "mal" };
const FINDING_TEXT: Record<string, string> = {
  invented: "inventó un dato",
  unanswered: "no respondió",
  no_next_step: "sin siguiente paso",
  handoff: "pasar a una persona",
  tone: "forma",
  good: "bien hecho",
};
/** Cuánto de cada conversación de ejemplo se le pasa. */
const EXAMPLE_MAX = 2600;

export interface ProposalFailure {
  caseTitle: string;
  brief: string;
  verdict: string;
  goal: boolean | null;
  summary: string;
  findings: SimulationFinding[];
  lines: SimulationReviewLine[];
}

/** Lo que lee la IA que propone: las instrucciones enteras, cómo le fue y las conversaciones que salieron mal. */
export function proposalRequest(input: { instructions: string; score: ImproveScore; failures: ProposalFailure[] }): string {
  const { score } = input;
  const examples = input.failures.map((f) => {
    const talk = f.lines
      .map((l) => {
        if (l.who === "customer") return `CLIENTE: ${l.text}`;
        const consulted = l.consulted.length ? `\n  (consultó: ${l.consulted.map((c) => c.replace(/\s+/g, " ").slice(0, 300)).join(" | ")})` : "";
        const handoff = l.handoff ? `\n  (pasó el chat a una persona: ${l.handoff})` : "";
        return `AGENTE: ${l.text || "(sin mensaje)"}${consulted}${handoff}`;
      })
      .join("\n")
      .slice(0, EXAMPLE_MAX);
    const marks = f.findings
      .filter((x) => x.kind !== "good")
      .map((x) => `- [${FINDING_TEXT[x.kind] ?? x.kind}] ${x.note}${x.quote ? ` («${x.quote}»)` : ""}`)
      .join("\n");
    return [
      `### Caso: ${f.caseTitle}`,
      `El cliente: ${f.brief}`,
      `Veredicto: ${VERDICT_TEXT[f.verdict] ?? f.verdict}${f.goal === false ? " · no llegó a buen fin" : ""}${f.summary ? ` · ${f.summary}` : ""}`,
      marks ? `Lo que marcó el revisor:\n${marks}` : "",
      `Conversación:\n${talk}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `## Instrucciones actuales del agente\n${input.instructions}`,
    `## Cómo le fue (${score.conversations} conversaciones simuladas)\nAtendió bien: ${score.ok} de ${score.conversations}\nInventó un dato: ${score.invented}\nLlegó a buen fin: ${score.goal} de ${score.conversations}`,
    `## Conversaciones que salieron mal\n${examples.join("\n\n") || "(ninguna)"}`,
  ].join("\n\n");
}

// ── Leer, aplicar y comprobar la propuesta ───────────────────
export interface ProposedEdit {
  what: string;
  why: string;
  caseTitle: string | null;
  action: "add" | "replace" | "remove";
  /** La línea de las instrucciones a la que se refiere; vacío = al final (solo al añadir). */
  anchor: string;
  /** Lo que se añade o lo que queda en su lugar. */
  text: string;
}

const ACTIONS: Record<string, ProposedEdit["action"]> = {
  add: "add",
  añadir: "add",
  agregar: "add",
  replace: "replace",
  reemplazar: "replace",
  cambiar: "replace",
  corregir: "replace",
  remove: "remove",
  quitar: "remove",
  eliminar: "remove",
  borrar: "remove",
};

/** Una línea sin viñeta, comillas ni espacios de más: así se compara lo que copió la IA con lo que hay. */
function bare(line: string): string {
  return line
    .trim()
    .replace(/^["'`“”«»]+|["'`“”«»]+$/g, "")
    .replace(/^[-•*·–—]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Los cambios que propuso la IA; null si su respuesta no trae una lista que se pueda leer. */
export function parseProposal(raw: string): ProposedEdit[] | null {
  const body = raw.match(/<cambios>([\s\S]*?)(?:<\/cambios>|$)/i)?.[1] ?? raw;
  const from = body.indexOf("[");
  const to = body.lastIndexOf("]");
  if (from < 0 || to < from) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(from, to + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const edits: ProposedEdit[] = [];
  for (const item of parsed) {
    const c = (item ?? {}) as Record<string, unknown>;
    const action = ACTIONS[str(c.action).toLowerCase()];
    const text = str(c.text);
    const anchor = str(c.anchor);
    if (!action || (action !== "remove" && !text) || (action !== "add" && !anchor)) continue;
    const what =
      str(c.what) || (action === "add" ? `Regla nueva: ${bare(text).replace(/^./, (x) => x.toUpperCase())}` : action === "replace" ? `Cambia «${anchor}»` : `Quita «${anchor}»`);
    const from = str(c.case) || str(c.caseTitle);
    edits.push({ what: what.slice(0, 300), why: str(c.why).slice(0, 300), caseTitle: from ? from.slice(0, 80) : null, action, anchor, text });
  }
  // Se leen algunos más de los que se aplican: si alguno no vale, que no deje fuera a uno bueno.
  return edits.slice(0, EDITS_MAX * 2);
}

/** Dinero, porcentajes, horas y plazos: lo que en unas instrucciones es un dato del negocio y no una regla de conducta. */
const BUSINESS_DATA_RE =
  /(?:S\/\.?|US\$|\$|€|£)\s?\d[\d.,]*|\d[\d.,]*\s?(?:%|soles|d[oó]lares|pesos|euros|usd|pen|mxn)(?![a-záéíóúñ])|\d{1,2}:\d{2}|\d+\s?(?:h|hrs|horas?|am|pm|d[ií]as?|semanas?|meses|años?)(?![a-záéíóúñ])|\d{3,}/gi;

/** Un dato del negocio que el texto trae y las instrucciones del dueño no: un precio, un descuento, un plazo. */
function newBusinessData(base: string, text: string): string | null {
  const flat = base.replace(/\s+/g, "").toLowerCase();
  for (const m of text.matchAll(BUSINESS_DATA_RE)) {
    if (!flat.includes(m[0].replace(/\s+/g, "").toLowerCase())) return m[0];
  }
  return null;
}

/**
 * Coloca los cambios sobre las instrucciones del dueño. Las líneas de
 * referencia se buscan siempre en el texto original, así el orden de los
 * cambios no importa: se puede corregir una línea y añadir una regla tras ella
 * en la misma propuesta. Una regla nueva cuya línea de referencia no existe va
 * al final (lo que vale es la regla). Se descarta solo, diciendo por qué, el
 * cambio que corrige o quita una línea que no existe o que ya cambiaba otro,
 * el que añade un dato del negocio que no estaba y el que quita algo que el
 * dueño puso para que el agente rellene o use. Los demás siguen valiendo.
 */
export function applyProposal(base: string, edits: ProposedEdit[]): { instructions: string; changes: ImproveChange[]; skipped: string[] } {
  const original = base.replace(/\r\n/g, "\n").split("\n");
  // Por cada línea original: lo que queda en su lugar (ella misma, otra o nada) y lo que se añade tras ella.
  const slots = original.map((line) => ({ line, now: [line], after: [] as string[], touched: false }));
  const atEnd: string[] = [];
  const changes: ImproveChange[] = [];
  const skipped: string[] = [];
  const isData = (inner: string) => !/[.,;:¿?¡!]/.test(inner) && inner.trim().split(/\s+/).length <= 4;
  const guarded = (s: string) => [...distinct(s, DATA_RE, isData), ...distinct(s, HOLE_RE), ...distinct(s, TOOL_RE)];
  const present = () => [...slots.flatMap((s) => [...s.now, ...s.after]), ...atEnd].map(bare);
  const find = (anchor: string): number => {
    const want = bare(anchor);
    if (!want) return -1;
    const exact = original.findIndex((l) => bare(l) === want);
    if (exact >= 0 || want.length < 12) return exact;
    // La IA a veces copia solo un trozo de la línea: vale si señala una sola.
    const partial = original.map((l, i) => (bare(l).includes(want) ? i : -1)).filter((i) => i >= 0);
    return partial.length === 1 ? partial[0]! : -1;
  };

  for (const e of edits) {
    const skip = (why: string) => skipped.push(`«${e.what}»: ${why}`);
    if (changes.length >= EDITS_MAX) {
      skip("eran demasiados cambios de una vez.");
      continue;
    }
    if (e.text.length > EDIT_TEXT_MAX) {
      skip("era demasiado largo para ser una regla.");
      continue;
    }
    const data = e.action === "remove" ? null : newBusinessData(base, e.text);
    if (data) {
      skip(`añadía un dato (${data}) que no está en tus instrucciones.`);
      continue;
    }
    const lines = e.text.split("\n").map((l) => l.trimEnd());
    const at = e.action === "add" && !e.anchor ? -1 : find(e.anchor);
    // Con la viñeta de la línea de referencia, si la IA la olvidó: el formato es del dueño.
    const bullet = at >= 0 ? (/^\s*[-•*·–—]\s+/.exec(original[at]!)?.[0] ?? "") : "";
    const added = lines.map((l) => (bullet && l.trim() && !/^\s*[-•*·–—]\s+/.test(l) ? `${bullet}${l.trim()}` : l));
    if (e.action === "add") {
      const have = present();
      if (added.every((l) => !bare(l) || have.includes(bare(l)))) {
        skip("ya estaba en tus instrucciones.");
        continue;
      }
      if (at >= 0) slots[at]!.after.push(...added);
      else atEnd.push(...added);
    } else {
      if (at < 0) {
        skip(`no encontró en tus instrucciones la línea «${e.anchor.slice(0, 80)}».`);
        continue;
      }
      const slot = slots[at]!;
      if (slot.touched) {
        skip("esa línea ya la cambiaba otro cambio de esta propuesta.");
        continue;
      }
      const lost = guarded(slot.line).filter((t) => e.action === "remove" || !e.text.includes(t));
      if (lost.length) {
        skip(`quitaba ${lost.slice(0, 3).join(", ")}, que tus instrucciones usan.`);
        continue;
      }
      slot.now = e.action === "replace" ? added : [];
      slot.touched = true;
    }
    changes.push({ what: e.what, why: e.why, caseTitle: e.caseTitle });
  }

  const lines = slots.flatMap((s) => [...s.now, ...s.after]);
  if (atEnd.length) {
    // Antes de las líneas en blanco del final, que se quedan donde estaban.
    let blank = 0;
    while (lines.length && !lines[lines.length - 1]!.trim()) {
      lines.pop();
      blank++;
    }
    lines.push(...atEnd, ...Array<string>(blank).fill(""));
  }
  return { instructions: lines.join("\n"), changes, skipped };
}

/** El tamaño máximo de las instrucciones de un agente. */
const PROMPT_MAX = 100_000;
/** Un dato del producto entre « »: corto y sin puntuación de frase («Precio normal», no «Hola, ¿qué tal?»). */
const DATA_RE = /«([^«»\n]{1,40})»/g;
const HOLE_RE = /\[([^[\]\n]{1,40})\]/g;
const TOOL_RE = /\b[a-z]+(?:_[a-z]+)+\b/g;

function distinct(text: string, re: RegExp, keep: (inner: string) => boolean = () => true): string[] {
  return [...new Set([...text.matchAll(re)].filter((m) => keep(m[1] ?? m[0])).map((m) => m[0]))];
}

/**
 * ¿Se le puede enseñar esta propuesta al dueño? Tiene que cambiar algo, no
 * dispararse de tamaño y conservar lo que el dueño puso para que el agente
 * rellene o use: los datos entre « », los huecos entre corchetes y los nombres
 * de las herramientas. Si pierde uno, el agente dejaría de dar ese dato o de
 * usar esa acción sin que nadie lo haya decidido.
 */
export function checkProposal(base: string, proposed: string): { ok: true } | { ok: false; reason: string } {
  const text = proposed.trim();
  if (!text) return { ok: false, reason: "La propuesta llegó vacía." };
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  if (squash(text) === squash(base)) return { ok: false, reason: "La propuesta no cambia nada." };
  if (text.length > PROMPT_MAX || text.length > Math.max(base.length * 1.5, base.length + 3000)) {
    return { ok: false, reason: "La propuesta es demasiado larga: unas instrucciones más largas se obedecen peor." };
  }
  const isData = (inner: string) => !/[.,;:¿?¡!]/.test(inner) && inner.trim().split(/\s+/).length <= 4;
  const lost = [...distinct(base, DATA_RE, isData), ...distinct(base, HOLE_RE), ...distinct(base, TOOL_RE)].filter((t) => !text.includes(t));
  if (lost.length) {
    return { ok: false, reason: `La propuesta quitó ${lost.slice(0, 4).join(", ")}${lost.length > 4 ? ` y ${lost.length - 4} más` : ""}, que tus instrucciones usan.` };
  }
  return { ok: true };
}

// ── Un caso sacado de un chat real ───────────────────────────
/** Tamaño de un caso: el de un escenario del simulador. */
const CASE_TITLE_MAX = 80;
const CASE_BRIEF_MIN = 10;
const CASE_BRIEF_MAX = 600;

export const CHAT_CASE_SYSTEM = [
  "Te dan un chat real entre un cliente y el agente de IA de un negocio. Lo conviertes en un caso de prueba para un simulador: otra IA hará de ese cliente contra el agente, así que describes la SITUACIÓN del cliente, no lo que pasó en el chat.",
  "",
  "Devuelves solo un JSON: {\"title\": \"…\", \"brief\": \"…\"}",
  "- title: de 3 a 8 palabras que distingan el caso (lo que el cliente quiere o su objeción).",
  "- brief: de 1 a 3 frases, en tercera persona: quién es el cliente, qué quiere, qué le frena y cómo reacciona según lo que le respondan. Es lo que guiará a la IA que hace de él.",
  "- Nunca escribas nombres de personas, teléfonos, correos, direcciones, documentos ni ningún dato que identifique al cliente. Di «el cliente».",
  "- No copies frases del agente ni juzgues cómo atendió: el caso sirve para probar cualquier versión de sus instrucciones.",
  "- No incluyas precios ni fechas concretas del negocio: pueden cambiar.",
].join("\n");

const SPEAKER: Record<string, string> = { customer: "Cliente", agent: "Agente", team: "Persona del equipo", auto: "Mensaje automático" };

/** El chat como se le pasa a la IA que redacta el caso: solo lo que se dijeron. */
export function chatCaseRequest(lines: SimulationReviewLine[]): string {
  const said = lines
    .filter((l) => l.text.trim())
    .map((l) => `${SPEAKER[l.who] ?? "Agente"}: ${l.text.trim().slice(0, 700)}`)
    .join("\n");
  return `Chat real:\n${said}\n\nDevuelve el JSON del caso de prueba.`;
}

/** Teléfonos, correos y números largos que se le hayan escapado a la IA. */
function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "su correo")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "su número")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** El caso que devolvió la IA, ya sin datos personales y a la medida de un caso; null si no es un caso. */
export function parseChatCase(raw: string): { title: string; brief: string } | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const { title, brief } = (data ?? {}) as { title?: unknown; brief?: unknown };
  if (typeof title !== "string" || typeof brief !== "string") return null;
  const out = { title: scrub(title).slice(0, CASE_TITLE_MAX), brief: scrub(brief).slice(0, CASE_BRIEF_MAX) };
  return out.title && out.brief.length >= CASE_BRIEF_MIN ? out : null;
}
