/**
 * «Mejorar agente»: la puntuación de una medición, la propuesta de la IA y lo
 * que se le exige antes de enseñarla, y la medición entera con el agente y la
 * base de datos simulados.
 *
 *   npm run test:improve --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareImprovement,
  estimateImprovementTokens,
  estimateSimulationTokens,
  improveIsPerfect,
  scoreImprovement,
  type ScoredConversation,
} from "@crm/shared";
import { parseSimulationReview, SIMULATION_REVIEW_SYSTEM } from "../src/modules/ai/simulation-review";
import { applyProposal, CHAT_CASE_SYSTEM, chatCaseRequest, checkProposal, improveLine, parseChatCase, parseProposal, proposalRequest, PROPOSAL_SYSTEM } from "../src/modules/ai/agent-improve.logic";
import { AgentImproveService } from "../src/modules/ai/agent-improve.service";
import { recordPromptVersion } from "../src/modules/ai/prompt-versions";

const conv = (caseId: string, verdict: ScoredConversation["verdict"], goal: boolean | null = false, invented = false): ScoredConversation => ({
  caseId,
  caseTitle: `Caso ${caseId}`,
  verdict,
  goal,
  findings: invented ? [{ kind: "invented" }] : [],
});

test("la puntuación: tres conteos a la vista y una nota interna de 0 a 3 por conversación", () => {
  const s = scoreImprovement([
    conv("a", "ok", true),
    conv("a", "ok", false),
    conv("a", "review", true),
    conv("b", "bad", false, true),
    conv("b", "review", false),
    conv("b", null, null), // no se pudo simular: ni suma ni cuenta en el máximo
  ]);
  assert.deepEqual(
    { conversations: s.conversations, ok: s.ok, review: s.review, bad: s.bad, invented: s.invented, goal: s.goal, failed: s.failed },
    { conversations: 5, ok: 2, review: 2, bad: 1, invented: 1, goal: 2, failed: 1 },
  );
  assert.equal(s.points, 3 + 2 + 2 + 0 + 1);
  assert.equal(s.max, 15);
  assert.deepEqual(s.cases, [
    { caseId: "a", title: "Caso a", conversations: 3, ok: 2, invented: 0, goal: 2 },
    { caseId: "b", title: "Caso b", conversations: 2, ok: 0, invented: 1, goal: 0 },
  ]);
  assert.equal(improveIsPerfect(s), false);
  assert.equal(improveIsPerfect(scoreImprovement([conv("a", "ok", true), conv("a", "ok", true)])), true);
  assert.equal(improveIsPerfect(scoreImprovement([])), false, "sin conversaciones no hay nada que dar por bueno");
});

test("una propuesta que inventa más nunca gana, y una diferencia pequeña no se canta como mejora", () => {
  const base = scoreImprovement([conv("a", "review", false), conv("a", "review", false), conv("a", "ok", false), conv("a", "review", true)]);
  // 5 de 12 → 9 de 12: mejora clara.
  const better = scoreImprovement([conv("a", "ok", true), conv("a", "ok", false), conv("a", "ok", false), conv("a", "review", true)]);
  assert.equal(compareImprovement(base, better), "better");
  // 5 → 6 de 12: menos del 10 % del máximo.
  const noise = scoreImprovement([conv("a", "review", false), conv("a", "review", true), conv("a", "ok", false), conv("a", "review", true)]);
  assert.equal(compareImprovement(base, noise), "same");
  // Más puntos, pero inventó un dato que la de partida no inventaba.
  const invents = scoreImprovement([conv("a", "ok", true), conv("a", "ok", true), conv("a", "ok", true), conv("a", "bad", true, true)]);
  assert.equal(compareImprovement(base, invents), "worse");
  assert.equal(compareImprovement(better, base), "worse");
  assert.equal(compareImprovement(base, scoreImprovement([])), "same", "sin nada medido no se compara");
});

test("el coste estimado suma las conversaciones de cada versión y lo que cuesta redactar cada propuesta", () => {
  const one = estimateSimulationTokens(6500, 4);
  assert.equal(estimateImprovementTokens(6500, 6, 3, 4, 0), 18 * one, "solo medir");
  const improving = estimateImprovementTokens(6500, 6, 3, 4, 1);
  assert.ok(improving > 36 * one && improving < 36 * one + 20_000, "medir, proponer y volver a medir");
  // Una propuesta lee las conversaciones que fallaron y razona: medido con gpt-5-mini, unas 9.000 aunque las instrucciones sean cortas.
  const proposal = estimateImprovementTokens(500, 1, 1, 4, 1) - 2 * estimateSimulationTokens(500, 4);
  assert.ok(proposal >= 9000 && proposal <= 10_000, `una propuesta: ${proposal}`);
});

test("el revisor dice además si la conversación llegó a buen fin", () => {
  assert.match(SIMULATION_REVIEW_SYSTEM, /Buen fin/);
  assert.match(SIMULATION_REVIEW_SYSTEM, /"goal": true\|false/);
  const yes = parseSimulationReview('{"verdict":"ok","summary":"Bien","goal":true,"findings":[]}');
  assert.equal(yes?.goal, true);
  assert.equal(parseSimulationReview('{"verdict":"review","summary":"","goal":false,"findings":[]}')?.goal, false);
  assert.equal(parseSimulationReview('{"verdict":"ok","summary":"","findings":[]}')?.goal, null, "un revisor que no lo dice no rompe nada");
});

test("la conversación simulada se le pasa al revisor con lo que consultó el agente", () => {
  const line = improveLine({
    reply: "El curso cuesta S/ 290.",
    simulatedActions: ["Movería a la etapa «Interesado»"],
    escalate: false,
    escalationReason: null,
    toolsUsed: ["search_products"],
    toolCalls: [
      { name: "search_products", input: "«genómica»", summary: "Encontró 1: Genómica.", evidence: '{"price":290}' },
      { name: "reply_with_buttons", input: "", summary: "Sí · No" }, // los botones no son una consulta
    ],
    options: ["Sí", "No"],
  } as never);
  assert.equal(line.who, "agent");
  assert.equal(line.text, "El curso cuesta S/ 290.");
  assert.deepEqual(line.consulted, [
    'search_products «genómica» → Encontró 1: Genómica.\nDevolvió: {"price":290}',
    "Acción (no aplicada en la prueba): Movería a la etapa «Interesado»",
  ]);
  assert.deepEqual(line.options, ["Sí", "No"]);
  assert.equal(line.handoff, null);
  const handed = improveLine({ reply: null, simulatedActions: [], escalate: true, escalationReason: "Pide un asesor", toolsUsed: [], toolCalls: [] } as never);
  assert.equal(handed.text, "");
  assert.equal(handed.handoff, "Pide un asesor");
});

const BASE = [
  "Eres Lia, asesora de Flyteek.",
  "PITCH",
  "🔬 *«Nombre»*",
  "📅 «Fechas» · 💰 [precio]",
  "Antes de dar un precio usa search_products. Si no sabes algo, handoff_to_human.",
].join("\n");

test("una propuesta solo vale si conserva los datos, los huecos y las herramientas del dueño", () => {
  const good = `${BASE}\nDESPUÉS DEL PITCH\n- Si pregunta algo que no sabes → "Déjame consultarlo 👍" y handoff_to_human.`;
  assert.deepEqual(checkProposal(BASE, good), { ok: true });
  assert.match((checkProposal(BASE, BASE) as { reason: string }).reason, /no cambia nada/);
  assert.match((checkProposal(BASE, "  ") as { reason: string }).reason, /vacía/);
  assert.match((checkProposal(BASE, good.replace("«Fechas»", "las fechas")) as { reason: string }).reason, /«Fechas»/);
  assert.match((checkProposal(BASE, good.replace("[precio]", "S/ 290")) as { reason: string }).reason, /\[precio\]/);
  assert.match((checkProposal(BASE, good.replaceAll("search_products", "el catálogo")) as { reason: string }).reason, /search_products/);
  assert.match((checkProposal(BASE, `${good}\n${"relleno ".repeat(2000)}`) as { reason: string }).reason, /demasiado larga/);
  // Puede crecer algo, también en unas instrucciones cortas.
  assert.deepEqual(checkProposal("Eres Lia.", `Eres Lia.\n${"Una regla nueva. ".repeat(60)}`), { ok: true });
});

const edits = (list: Record<string, unknown>[]) => `Aquí va.\n<cambios>\n${JSON.stringify(list, null, 1)}\n</cambios>`;

test("la IA propone cambios puntuales y el servidor los aplica sobre las instrucciones del dueño", () => {
  const raw = edits([
    { what: "Nueva regla para lo que no sabe", why: "Decía «no tengo esa información» y seguía con el cierre", case: "Pide qué incluye", action: "add", anchor: "PITCH", text: '- Si no sabes un dato → "Déjame consultarlo 👍".' },
    { what: "Una sola pregunta por mensaje", why: "Hacía dos seguidas", action: "add", anchor: "", text: "- Una pregunta por mensaje." },
    {
      what: "Antes de pasar el chat, avisa",
      why: "Pasaba el chat sin decir nada",
      case: null,
      action: "replace",
      anchor: "Antes de dar un precio usa search_products. Si no sabes algo, handoff_to_human.",
      text: "Antes de dar un precio usa search_products. Si no sabes algo, avisa y usa handoff_to_human.",
    },
  ]);
  const out = applyProposal(BASE, parseProposal(raw)!);
  assert.equal(
    out.instructions,
    [
      "Eres Lia, asesora de Flyteek.",
      "PITCH",
      '- Si no sabes un dato → "Déjame consultarlo 👍".',
      "🔬 *«Nombre»*",
      "📅 «Fechas» · 💰 [precio]",
      "Antes de dar un precio usa search_products. Si no sabes algo, avisa y usa handoff_to_human.",
      "- Una pregunta por mensaje.",
    ].join("\n"),
  );
  assert.deepEqual(out.changes, [
    { what: "Nueva regla para lo que no sabe", why: "Decía «no tengo esa información» y seguía con el cierre", caseTitle: "Pide qué incluye" },
    { what: "Una sola pregunta por mensaje", why: "Hacía dos seguidas", caseTitle: null },
    { what: "Antes de pasar el chat, avisa", why: "Pasaba el chat sin decir nada", caseTitle: null },
  ]);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(checkProposal(BASE, out.instructions), { ok: true });
});

test("quitar una línea, y la línea de referencia se encuentra aunque la IA la copie con viñeta, comillas o espacios de más", () => {
  const base = "Eres Lia.\n\nREGLAS\n- Responde de forma completa y detallada.\n- Saluda siempre.";
  const out = applyProposal(
    base,
    parseProposal(
      edits([
        { what: "Quita «responde detallado»", why: "Los mensajes salían larguísimos", action: "quitar", anchor: '"Responde de forma  completa y detallada."' },
        { what: "Mensajes cortos", why: "Los mensajes salían larguísimos", action: "añadir", anchor: "reglas", text: "- Mensajes cortos, de 2 o 3 líneas." },
      ]),
    )!,
  );
  assert.equal(out.instructions, "Eres Lia.\n\nREGLAS\n- Mensajes cortos, de 2 o 3 líneas.\n- Saluda siempre.");
  assert.equal(out.changes.length, 2);
});

test("un cambio que añade un dato del negocio, quita uno del dueño o corrige una línea que no existe se descarta solo, con su motivo", () => {
  const out = applyProposal(
    BASE,
    parseProposal(
      edits([
        { what: "Corrige una línea que no existe", why: "x", action: "replace", anchor: "CIERRE DE VENTA", text: "CIERRE" },
        { what: "Ofrece el descuento", why: "x", action: "add", anchor: "PITCH", text: "- Si duda, ofrece 20% de descuento hasta el viernes." },
        { what: "Da el precio", why: "x", action: "add", anchor: "PITCH", text: "- El curso cuesta S/ 290." },
        { what: "Simplifica la línea de fechas", why: "x", action: "replace", anchor: "📅 «Fechas» · 💰 [precio]", text: "📅 las fechas del curso" },
        { what: "Quita la herramienta", why: "x", action: "remove", anchor: "Antes de dar un precio usa search_products. Si no sabes algo, handoff_to_human." },
        { what: "Regla larguísima", why: "x", action: "add", anchor: "PITCH", text: `- ${"muy largo ".repeat(80)}` },
        { what: "Repite lo que ya está", why: "x", action: "add", anchor: "", text: "PITCH" },
        { what: "La única que vale", why: "No proponía avanzar", action: "add", anchor: "PITCH", text: "- Termina proponiendo el siguiente paso." },
      ]),
    )!,
  );
  assert.deepEqual(out.changes, [{ what: "La única que vale", why: "No proponía avanzar", caseTitle: null }]);
  assert.equal(out.instructions, BASE.replace("PITCH", "PITCH\n- Termina proponiendo el siguiente paso."));
  assert.equal(out.skipped.length, 7);
  assert.match(out.skipped[0]!, /no encontró.*CIERRE DE VENTA/);
  assert.match(out.skipped[1]!, /20%/);
  assert.match(out.skipped[2]!, /S\/ 290/);
  assert.match(out.skipped[3]!, /«Fechas»/);
  assert.match(out.skipped[4]!, /search_products/);
  assert.match(out.skipped[5]!, /larg/);
  assert.match(out.skipped[6]!, /ya est/);
  // Un número que el dueño ya tenía en sus instrucciones no es un dato nuevo; ni lo es «2 mensajes».
  const priced = "Eres Lia.\nEl curso cuesta S/ 350.";
  const ok = applyProposal(priced, parseProposal(edits([{ what: "Di el precio primero", why: "x", action: "add", anchor: "", text: "- Si preguntan el precio, di S/ 350 y luego, en 2 mensajes como mucho, lo demás." }]))!);
  assert.equal(ok.changes.length, 1);
});

test("sin una lista de cambios que se pueda leer no hay propuesta; y como mucho seis cambios", () => {
  assert.equal(parseProposal("Aquí tienes unas ideas para mejorar."), null);
  assert.equal(parseProposal("<cambios>no es json</cambios>"), null);
  assert.deepEqual(parseProposal("<cambios>[]</cambios>"), []);
  // Sin etiquetas o dentro de un bloque de código también se lee; lo que no trae acción ni texto se ignora.
  const loose = parseProposal('```json\n[{"what":"a","why":"b","action":"add","anchor":"","text":"- Regla."},{"what":"sin acción"},{"action":"add","text":"- Otra regla."}]\n```')!;
  assert.deepEqual(loose.map((e) => [e.action, e.text, e.what]), [
    ["add", "- Regla.", "a"],
    ["add", "- Otra regla.", "Regla nueva: Otra regla."],
  ]);
  // El tope es de cambios aplicados: los que sobran se descartan y se dice.
  const many = applyProposal(BASE, parseProposal(edits(Array.from({ length: 9 }, (_, i) => ({ what: `c${i}`, why: "x", action: "add", anchor: "", text: `- Regla ${i}.` }))))!);
  assert.equal(many.changes.length, 6);
  assert.equal(many.skipped.length, 3);
  assert.match(many.skipped[0]!, /demasiados cambios/);
  assert.ok(many.instructions.endsWith("- Regla 5."));
});

test("el encargo a la IA que propone lleva las instrucciones, lo que falló y la prohibición de añadir datos", () => {
  assert.match(PROPOSAL_SYSTEM, /Nunca añadas datos del negocio/);
  assert.match(PROPOSAL_SYSTEM, /<cambios>/);
  assert.match(PROPOSAL_SYSTEM, /"anchor"/);
  assert.match(PROPOSAL_SYSTEM, /no texto para copiar/, "la guía de venta es criterio, no se pega en las instrucciones");
  assert.match(PROPOSAL_SYSTEM, /una pregunta por mensaje/i);
  const ask = proposalRequest({
    instructions: BASE,
    score: scoreImprovement([conv("a", "review", false), conv("a", "ok", true), conv("b", "bad", false, true)]),
    failures: [
      {
        caseTitle: "Pide qué incluye",
        brief: "Pregunta qué incluye el curso.",
        verdict: "review",
        goal: false,
        summary: "No resolvió la duda.",
        findings: [{ kind: "unanswered", note: "Dijo que no tenía el dato y siguió con el cierre.", quote: "Este curso no especifica qué incluye" }],
        lines: [
          { who: "customer", text: "¿Qué incluye?", consulted: [], options: [], handoff: null },
          { who: "agent", text: "Este curso no especifica qué incluye. ¿Te comparto los datos de pago?", consulted: ["search_products «curso» → Encontró 1."], options: [], handoff: null },
        ],
      },
    ],
  });
  assert.ok(ask.includes(BASE), "las instrucciones enteras");
  assert.match(ask, /Atendió bien: 1 de 3/);
  assert.match(ask, /Inventó un dato: 1/);
  assert.match(ask, /Pide qué incluye/);
  assert.match(ask, /CLIENTE: ¿Qué incluye\?/);
  assert.match(ask, /AGENTE: Este curso no especifica qué incluye/);
  assert.match(ask, /Dijo que no tenía el dato y siguió con el cierre/);
});

// ── La medición entera, con el agente, la IA y la base simulados ──

type AnyRow = Record<string, any>;

/** Una base en memoria con lo justo de Prisma que usa el servicio. */
function memory(prompt = BASE) {
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const bots = new Map<string, AnyRow>([["b1", { id: "b1", orgId: "o1", name: "Lia", model: "gpt-test", systemPrompt: prompt }]]);
  const cases: AnyRow[] = [];
  const runs: AnyRow[] = [];
  const results: AnyRow[] = [];
  const versions: AnyRow[] = [];
  const conversations: AnyRow[] = [];
  const messages: AnyRow[] = [];
  const match = (row: AnyRow, where: AnyRow = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? (v.in as unknown[]).includes(row[k]) : row[k] === v));
  const patch = (row: AnyRow, data: AnyRow) => {
    for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
    return row;
  };
  const table = (rows: AnyRow[], prefix: string, defaults: () => AnyRow) => ({
    count: async ({ where }: AnyRow = {}) => rows.filter((r) => match(r, where)).length,
    create: async ({ data }: AnyRow) => {
      const row = { id: id(prefix), createdAt: new Date(Date.now() + seq), ...defaults(), ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: AnyRow) => void (data as AnyRow[]).forEach((d) => rows.push({ id: id(prefix), ...defaults(), ...d })),
    findMany: async ({ where, skip = 0, take, orderBy }: AnyRow = {}) => {
      let out = rows.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => b.createdAt - a.createdAt);
      return out.slice(skip, take ? skip + take : undefined);
    },
    findFirst: async ({ where, orderBy }: AnyRow = {}) => {
      const out = rows.filter((r) => match(r, where));
      return (orderBy?.createdAt === "desc" ? out.at(-1) : out[0]) ?? null;
    },
    findUnique: async ({ where }: AnyRow) => rows.find((r) => r.id === where.id) ?? null,
    update: async ({ where, data }: AnyRow) => patch(rows.find((r) => r.id === where.id)!, data),
    updateMany: async ({ where, data }: AnyRow) => void rows.filter((r) => match(r, where)).forEach((r) => patch(r, data)),
    delete: async ({ where }: AnyRow) => void rows.splice(rows.findIndex((r) => r.id === where.id), 1),
    deleteMany: async ({ where }: AnyRow) => {
      for (const gone of where.id.in as string[]) rows.splice(rows.findIndex((r) => r.id === gone), 1);
    },
  });
  const prisma = {
    agentConfig: { findUnique: async ({ where }: AnyRow) => bots.get(where.id) ?? null, update: async ({ where, data }: AnyRow) => patch(bots.get(where.id)!, data) },
    agentTestCase: table(cases, "c", () => ({ isActive: true, source: "custom" })),
    agentImprovementRun: table(runs, "r", () => ({ best: null, done: 0, total: 0, tokens: 0, error: null, appliedVariant: null, appliedAt: null, finishedAt: null, contact: null })),
    agentImprovementResult: table(results, "x", () => ({})),
    agentPromptVersion: table(versions, "v", () => ({})),
    conversation: { findUnique: async ({ where }: AnyRow) => conversations.find((c) => c.id === where.id) ?? null },
    // Como Prisma con orderBy desc: del más reciente al más antiguo.
    message: { findMany: async ({ where }: AnyRow) => messages.filter((m) => m.conversationId === where.conversationId).reverse() },
    aiRun: { findMany: async () => [{ id: "run1", status: "COMPLETED", escalationReason: null, agentConfigId: "b1", toolCalls: [] }] },
  };
  return { prisma, bots, cases, runs, results, versions, conversations, messages };
}

const DRAFT = '{"title":"«Es caro, lo pienso»","brief":"Vio el anuncio de un curso, le parece caro y dice que lo va a pensar. Escribe desde el 987654321."}';
const NEW_RULE = 'REGLA NUEVA: si pregunta algo que no sabes → "Déjame consultarlo 👍" y handoff_to_human.';
/** Lo que devuelve la IA que propone: un cambio puntual (de serie, añadir la regla nueva al final). */
const proposal = (edit: AnyRow = {}) =>
  `<cambios>${JSON.stringify([{ what: "Regla para lo que no sabe", why: "No proponía el siguiente paso", case: "Pregunta el precio", action: "add", anchor: "", text: NEW_RULE, ...edit }])}</cambios>`;

/**
 * El servicio con todo simulado. El agente «atiende bien» cuando sus instrucciones llevan la regla
 * nueva, así una propuesta que la añade mejora y una que no, no. `gate` deja la medición esperando.
 */
function improve(opts: { proposes?: string; drafts?: string; ai?: AnyRow; gate?: Promise<void>; prompt?: string; rejectModel?: string; quotaAfter?: number } = {}) {
  const db = memory(opts.prompt);
  const turns: { scenario: string; prompt: string; contact?: AnyRow }[] = [];
  const asked: string[] = [];
  const reviewed: AnyRow[] = [];
  const calls: AnyRow[] = [];
  const agent = {
    simulateTurn: async (input: AnyRow, o: AnyRow) => {
      await opts.gate;
      if (opts.quotaAfter !== undefined && turns.length >= opts.quotaAfter) {
        return { customer: null, agent: null, ended: "error", error: 'OpenAI 429: {"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}', tokens: 0 };
      }
      turns.push({ scenario: input.scenario.title, prompt: o.systemPrompt, contact: input.contact });
      assert.equal(o.feature, "improve", "el gasto se anota como mejora del agente");
      const said = (input.history as AnyRow[]).filter((h) => h.role === "user").length;
      return {
        customer: `mensaje ${said + 1} del cliente`,
        agent: { reply: `respuesta ${said + 1}`, simulatedActions: [], escalate: false, escalationReason: null, toolsUsed: [], toolCalls: [], options: [] },
        ended: said + 1 >= input.maxTurns ? "max_turns" : null,
        error: null,
        tokens: 100,
      };
    },
    reviewTranscript: async (input: AnyRow, o: AnyRow) => {
      reviewed.push(input);
      const good = (o.instructions as string).includes("REGLA NUEVA");
      return {
        verdict: good ? "ok" : "review",
        summary: good ? "Atendió bien." : "No propuso avanzar.",
        goal: good,
        findings: good ? [] : [{ kind: "no_next_step", note: "No propuso el siguiente paso.", quote: null }],
        tokens: 50,
      };
    },
  };
  const llm = {
    generate: async (req: AnyRow) => {
      calls.push({ model: req.model, effort: req.effort, system: req.system });
      if (opts.rejectModel && req.model === opts.rejectModel) throw new Error("The model does not exist or you do not have access to it.");
      asked.push(req.messages[0].content);
      assert.equal(req.feature, "improve");
      const text = req.system === CHAT_CASE_SYSTEM ? opts.drafts ?? DRAFT : opts.proposes ?? proposal();
      return { content: [{ type: "text", text }], usage: { inputTokens: 900, outputTokens: 100 } };
    },
  };
  const aiSettings = { status: async () => opts.ai ?? { ready: true, included: null } };
  const svc = new AgentImproveService(db.prisma as never, { orgId: () => "o1" } as never, agent as never, aiSettings as never, llm as never);
  return { svc, db, turns, asked, reviewed, calls };
}

test("la batería empieza con los casos de siempre del simulador, los de venta marcados", async () => {
  const t = improve();
  const first = await t.svc.overview("b1");
  assert.equal(first.cases.length, 6);
  assert.deepEqual(first.cases.filter((c) => c.isActive).map((c) => c.title), ["Pregunta el precio", "Está indeciso", "Pregunta algo que no está previsto"]);
  assert.ok(first.cases.every((c) => c.source === "preset"));
  assert.equal(first.run, null);
  assert.equal(first.busy, false);
  assert.equal((await t.svc.overview("b1")).cases.length, 6, "no se vuelven a crear");

  const own = await t.svc.createCase("b1", { title: "Pide qué incluye", brief: "Pregunta qué incluye el curso y qué requisitos tiene." });
  assert.equal(own.source, "custom");
  assert.equal((await t.svc.updateCase("b1", own.id, { isActive: false })).isActive, false);
  await t.svc.deleteCase("b1", own.id);
  assert.equal((await t.svc.overview("b1")).cases.length, 6);
  await assert.rejects(t.svc.updateCase("b1", "no-existe", { isActive: true }), /no encontrado/);
  await assert.rejects(t.svc.overview("otro-agente"), /no encontrado/);
});

test("solo medir: cada caso las veces pedidas, con las instrucciones guardadas y sin tocar el agente", async () => {
  const t = improve();
  const cases = (await t.svc.overview("b1")).cases.slice(0, 2);
  const started = await t.svc.start("b1", { caseIds: cases.map((c) => c.id), repetitions: 3, turns: 4, rounds: 0 });
  assert.equal(started.status, "running");
  assert.equal(started.total, 6);
  await t.svc.settled(started.id);

  const run = await t.svc.run("b1", started.id);
  assert.equal(run.status, "done");
  assert.deepEqual([run.done, run.total], [6, 6]);
  assert.equal(run.tokens, 6 * (4 * 100 + 50), "lo que gastaron las conversaciones y sus revisiones");
  assert.equal(run.variants.length, 1);
  assert.deepEqual(
    { status: run.variants[0]!.status, conversations: run.variants[0]!.score!.conversations, ok: run.variants[0]!.score!.ok, goal: run.variants[0]!.score!.goal },
    { status: "done", conversations: 6, ok: 0, goal: 0 },
  );
  assert.equal(run.best, null);
  assert.equal(run.agentChanged, false);
  assert.ok(t.turns.every((x) => x.prompt === BASE), "se mide lo guardado");
  assert.equal(t.turns.length, 6 * 4);
  assert.equal(t.asked.length, 0, "sin vueltas no se propone nada");
  assert.equal(t.db.bots.get("b1")!.systemPrompt, BASE);

  const chats = await t.svc.results("b1", run.id, 0, cases[0]!.id);
  assert.equal(chats.length, 3);
  assert.deepEqual(chats.map((c) => c.repetition), [1, 2, 3]);
  assert.equal(chats[0]!.lines.length, 8, "cuatro mensajes del cliente y sus respuestas");
  assert.equal(chats[0]!.verdict, "review");
  assert.equal(chats[0]!.goal, false);
});

test("medir y proponer: la propuesta se mide con los mismos casos, y el agente solo cambia al aplicar", async () => {
  const t = improve();
  const cases = (await t.svc.overview("b1")).cases.slice(0, 2);
  const started = await t.svc.start("b1", { caseIds: cases.map((c) => c.id), repetitions: 3, turns: 4, rounds: 1 });
  assert.equal(started.total, 12, "las de partida y las de la propuesta");
  await t.svc.settled(started.id);

  const run = await t.svc.run("b1", started.id);
  assert.equal(run.status, "done");
  const [base, prop] = run.variants;
  assert.equal(prop!.kind, "proposal");
  assert.equal(prop!.status, "done");
  assert.equal(prop!.prompt, `${BASE}\n${NEW_RULE}`, "las instrucciones de siempre con el cambio aplicado");
  assert.deepEqual(prop!.changes, [{ what: "Regla para lo que no sabe", why: "No proponía el siguiente paso", caseTitle: "Pregunta el precio" }]);
  assert.deepEqual([base!.score!.points, prop!.score!.points], [6, 18]);
  assert.equal(prop!.comparison, "better");
  assert.equal(run.best, 1);
  // La IA que propone leyó las instrucciones y lo que falló.
  assert.ok(t.asked[0]!.includes(BASE));
  assert.match(t.asked[0]!, /No propuso el siguiente paso/);
  // Los mismos casos, con unas instrucciones y con las otras.
  assert.deepEqual([...new Set(t.turns.filter((x) => x.prompt === BASE).map((x) => x.scenario))], cases.map((c) => c.title));
  assert.deepEqual([...new Set(t.turns.filter((x) => x.prompt !== BASE).map((x) => x.scenario))], cases.map((c) => c.title));

  // Hasta aquí el agente no cambió.
  assert.equal(t.db.bots.get("b1")!.systemPrompt, BASE);
  assert.equal(t.db.versions.length, 0);

  const applied = await t.svc.apply("b1", run.id, { variant: 1, force: false });
  assert.equal(t.db.bots.get("b1")!.systemPrompt, prop!.prompt);
  assert.equal(applied.appliedVariant, 1);
  assert.equal(applied.agentChanged, false, "las instrucciones son las de la propuesta: nada que avisar");
  assert.deepEqual(t.db.versions.map((v) => [v.source, v.systemPrompt]), [["improve", BASE]], "la anterior queda guardada");

  // Y se puede volver atrás: la de ahora queda guardada a su vez.
  const after = await t.svc.restore("b1", t.db.versions[0]!.id);
  assert.equal(t.db.bots.get("b1")!.systemPrompt, BASE);
  assert.equal(after.versions.length, 2);
  assert.equal(after.versions[0]!.source, "restore");
  await assert.rejects(t.svc.restore("b1", "no-existe"), /ya no existe/);
});

test("si el dueño editó el agente mientras se medía, aplicar no pisa su cambio sin avisar", async () => {
  const t = improve();
  const cases = (await t.svc.overview("b1")).cases.slice(0, 1);
  const started = await t.svc.start("b1", { caseIds: [cases[0]!.id], repetitions: 1, turns: 4, rounds: 1 });
  await t.svc.settled(started.id);
  t.db.bots.get("b1")!.systemPrompt = `${BASE}\nUna línea que añadió el dueño.`;
  assert.equal((await t.svc.run("b1", started.id)).agentChanged, true);
  await assert.rejects(t.svc.apply("b1", started.id, { variant: 1, force: false }), /cambiaron desde que empezó la medición/);
  await t.svc.apply("b1", started.id, { variant: 1, force: true });
  assert.ok(t.db.bots.get("b1")!.systemPrompt.includes("REGLA NUEVA"));
  assert.match(t.db.versions[0]!.systemPrompt, /Una línea que añadió el dueño/, "y su versión se puede recuperar");
});

test("una propuesta que no cumple se descarta con el motivo, no se mide y no se puede aplicar", async () => {
  const t = improve({ proposes: proposal({ action: "replace", anchor: "📅 «Fechas» · 💰 [precio]", text: "📅 las fechas · 💰 [precio]" }) });
  const cases = (await t.svc.overview("b1")).cases.slice(0, 1);
  const started = await t.svc.start("b1", { caseIds: [cases[0]!.id], repetitions: 1, turns: 4, rounds: 2 });
  await t.svc.settled(started.id);
  const run = await t.svc.run("b1", started.id);
  assert.equal(run.status, "done");
  assert.deepEqual(run.variants.map((v) => v.status), ["done", "failed", "failed"], "cada vuelta lo intenta y se descarta");
  assert.match(run.variants[1]!.error!, /«Fechas»/);
  assert.equal(run.best, null);
  assert.deepEqual([run.done, run.total], [1, 1], "solo se midió la de partida");
  assert.ok(t.turns.every((x) => x.prompt === BASE));
  await assert.rejects(t.svc.apply("b1", run.id, { variant: 1, force: false }), /no existe o no llegó a medirse/);

  // Lo que no se puede leer, igual.
  const garbled = improve({ proposes: "Aquí tienes unas ideas." });
  const one = (await garbled.svc.overview("b1")).cases[0]!;
  const r2 = await garbled.svc.start("b1", { caseIds: [one.id], repetitions: 1, turns: 4, rounds: 1 });
  await garbled.svc.settled(r2.id);
  assert.match((await garbled.svc.run("b1", r2.id)).variants[1]!.error!, /no devolvió una propuesta/);
});

test("un agente que ya atiende bien no recibe propuestas: no hay nada que corregir", async () => {
  const t = improve({ prompt: `${BASE}\n${NEW_RULE}` });
  const one = (await t.svc.overview("b1")).cases[0]!;
  const started = await t.svc.start("b1", { caseIds: [one.id], repetitions: 1, turns: 4, rounds: 3 });
  await t.svc.settled(started.id);
  const run = await t.svc.run("b1", started.id);
  assert.equal(run.variants.length, 1);
  assert.equal(t.asked.length, 0);
  assert.deepEqual([run.done, run.total], [1, 1], "el total se ajusta a lo que se hizo");
});

test("una medición a la vez; sin IA o sin instrucciones no empieza; detenerla conserva lo medido", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const t = improve({ gate });
  const cases = (await t.svc.overview("b1")).cases;
  const started = await t.svc.start("b1", { caseIds: [cases[0]!.id], repetitions: 3, turns: 4, rounds: 1 });
  assert.equal((await t.svc.overview("b1")).busy, true);
  await assert.rejects(t.svc.start("b1", { caseIds: [cases[1]!.id], repetitions: 1, turns: 4, rounds: 0 }), /Ya hay una medición en marcha/);
  await assert.rejects(t.svc.apply("b1", started.id, { variant: 1, force: false }), /sigue en marcha/);

  await t.svc.cancelRun("b1", started.id);
  open();
  await t.svc.settled(started.id);
  const run = await t.svc.run("b1", started.id);
  assert.equal(run.status, "cancelled");
  assert.equal(t.asked.length, 0, "no se llegó a proponer");
  assert.equal(run.done, run.total);

  await assert.rejects(improve({ ai: { ready: false, included: null } }).svc.start("b1", { caseIds: ["x"], repetitions: 1, turns: 4, rounds: 0 }), /Marca al menos un caso|IA no está disponible/);
  const noAi = improve({ ai: { ready: false, included: null } });
  const c = (await noAi.svc.overview("b1")).cases[0]!;
  await assert.rejects(noAi.svc.start("b1", { caseIds: [c.id], repetitions: 1, turns: 4, rounds: 0 }), /IA no está disponible/);
  const spent = improve({ ai: { ready: true, included: { full: true, exhausted: false } } });
  const c2 = (await spent.svc.overview("b1")).cases[0]!;
  await assert.rejects(spent.svc.start("b1", { caseIds: [c2.id], repetitions: 1, turns: 4, rounds: 0 }), /Se agotaron los tokens/);
  const empty = improve({ prompt: "  " });
  await assert.rejects(empty.svc.start("b1", { caseIds: ["x"], repetitions: 1, turns: 4, rounds: 0 }), /no tiene instrucciones/);
  assert.equal(noAi.db.runs.length + spent.db.runs.length + empty.db.runs.length, 0, "nada queda a medias");
});

test("las instrucciones que se dejan atrás se guardan, y solo las últimas 20", async () => {
  const db = memory();
  for (let i = 1; i <= 23; i++) await recordPromptVersion(db.prisma as never, { orgId: "o1", agentConfigId: "b1", systemPrompt: `versión ${i}`, source: "manual" });
  assert.equal(db.versions.length, 20);
  assert.equal(db.versions.at(-1)!.systemPrompt, "versión 23");
  assert.ok(!db.versions.some((v) => v.systemPrompt === "versión 1"));
  await recordPromptVersion(db.prisma as never, { orgId: "o1", agentConfigId: "b1", systemPrompt: "   ", source: "manual" });
  assert.equal(db.versions.length, 20, "unas instrucciones vacías no dejan nada que recuperar");
});

// ── Un caso sacado de un chat real ────────────────────────────

test("el caso de un chat real es una situación, sin nombres ni teléfonos ni correos", () => {
  const req = chatCaseRequest([
    { who: "customer", text: "Hola, soy Marta. Vi el anuncio del curso", consulted: [], options: [], handoff: null },
    { who: "agent", text: "El curso cuesta S/ 350", consulted: ["search_products curso → 1 producto"], options: [], handoff: null },
    { who: "customer", text: "es caro, lo pienso", consulted: [], options: [], handoff: null },
  ]);
  assert.match(req, /Cliente: Hola, soy Marta/);
  assert.match(req, /Agente: El curso cuesta S\/ 350/);
  assert.ok(!req.includes("search_products"), "lo que consultó el agente no hace falta para describir al cliente");
  assert.match(CHAT_CASE_SYSTEM, /nombres|teléfonos/);

  assert.deepEqual(parseChatCase('```json\n{"title":"«Es caro, lo pienso»","brief":"Vio el anuncio de un curso, le parece caro y dice que lo va a pensar; si le ofrecen pagar en partes, pregunta cómo."}\n```'), {
    title: "«Es caro, lo pienso»",
    brief: "Vio el anuncio de un curso, le parece caro y dice que lo va a pensar; si le ofrecen pagar en partes, pregunta cómo.",
  });
  // Lo que se le escape a la IA se quita aquí.
  const scrubbed = parseChatCase('{"title":"Pide factura","brief":"Escribe desde el +51 987 654 321 y pide que le manden la factura a marta@correo.com antes de pagar el curso."}')!;
  assert.ok(!/987|654|321/.test(scrubbed.brief));
  assert.ok(!scrubbed.brief.includes("@"));
  assert.match(scrubbed.brief, /pide que le manden la factura/);
  // Largos de más se recortan a lo que admite un caso; sin las dos partes no hay caso.
  const long = parseChatCase(JSON.stringify({ title: "t".repeat(200), brief: "b".repeat(900) }))!;
  assert.deepEqual([long.title.length, long.brief.length], [80, 600]);
  assert.equal(parseChatCase('{"title":"Solo título"}'), null);
  assert.equal(parseChatCase('{"title":"x","brief":"corto"}'), null, "una descripción de cuatro letras no describe a nadie");
  assert.equal(parseChatCase("No puedo ayudar con eso."), null);
});

test("de un chat real sale un borrador de caso; al guardarlo queda como «de un chat real»", async () => {
  const t = improve();
  t.db.conversations.push({ id: "conv1", channelKind: "whatsapp" });
  const msg = (direction: string, content: string, ai = false) => ({ conversationId: "conv1", direction, author: ai ? "AI" : null, type: "TEXT", content, aiRunId: ai ? "run1" : null, interactive: null });
  t.db.messages.push(msg("INBOUND", "Hola, vi el anuncio del curso"), msg("OUTBOUND", "El curso cuesta S/ 350", true), msg("INBOUND", "es caro, lo pienso"));

  const draft = await t.svc.draftCaseFromChat("b1", "conv1");
  assert.equal(draft.title, "«Es caro, lo pienso»");
  assert.ok(!draft.brief.includes("987654321"), "sin el teléfono");
  assert.match(t.asked[0]!, /Cliente: Hola, vi el anuncio del curso\nAgente: El curso cuesta S\/ 350\nCliente: es caro, lo pienso/);
  assert.equal(t.db.cases.length, 0, "el borrador no se guarda solo: lo revisa el dueño");

  const saved = await t.svc.createCase("b1", { ...draft, conversationId: "conv1" });
  assert.equal(saved.source, "chat");
  assert.equal(t.db.cases.at(-1)!.conversationId, "conv1");
  assert.equal(t.db.cases.at(-1)!.isActive, true);

  await assert.rejects(t.svc.createCase("b1", { ...draft, conversationId: "no-existe" }), /Ese chat ya no existe/);
  await assert.rejects(t.svc.draftCaseFromChat("b1", "no-existe"), /Ese chat ya no existe/);
  // Un chat donde la IA no respondió no da para un caso del agente.
  t.db.conversations.push({ id: "conv2", channelKind: "whatsapp" });
  t.db.messages.push({ ...msg("INBOUND", "hola"), conversationId: "conv2" });
  await assert.rejects(t.svc.draftCaseFromChat("b1", "conv2"), /no respondió el agente/);
  // Y si la IA no devuelve un caso, se dice: lo escribe el dueño.
  const garbled = improve({ drafts: "No sé." });
  garbled.db.conversations.push({ id: "conv1", channelKind: "whatsapp" });
  garbled.db.messages.push(msg("INBOUND", "Hola"), msg("OUTBOUND", "Hola, ¿en qué te ayudo?", true));
  await assert.rejects(garbled.svc.draftCaseFromChat("b1", "conv1"), /No se pudo redactar el caso/);
});

test("la batería tiene un tope de casos guardados", async () => {
  const t = improve();
  await t.svc.overview("b1");
  for (let i = t.db.cases.length; i < 40; i++) await t.svc.createCase("b1", { title: `Caso ${i}`, brief: "Un cliente cualquiera que pregunta algo." });
  await assert.rejects(t.svc.createCase("b1", { title: "Uno más", brief: "Un cliente cualquiera que pregunta algo." }), /como mucho 40 casos/);
});

test("el cliente de prueba es el mismo en toda la medición, y el revisor sabe que el agente lo conocía", async () => {
  const t = improve();
  const one = (await t.svc.overview("b1")).cases[0]!;
  const contact = { name: "Ana", phone: "+51900000000" };
  const started = await t.svc.start("b1", { caseIds: [one.id], repetitions: 2, turns: 4, rounds: 0, contact });
  await t.svc.settled(started.id);
  assert.ok(t.turns.length > 0 && t.turns.every((x) => x.contact?.name === "Ana"), "el agente habla con Ana");
  assert.equal(t.reviewed.length, 2);
  assert.ok(t.reviewed.every((r) => r.contact?.name === "Ana"), "y el revisor lo sabe: usar su nombre no es inventar");
});

test("los cambios se colocan sobre el texto original: corregir una línea y añadir otra tras ella, en cualquier orden", () => {
  const base = ["Eres Lia.", "", "CÓMO ATIENDES", "- Responde de forma completa y detallada.", "", "DATOS", "- Horario: 9 a 18 h."].join("\n");
  const both = [
    { what: "Añade lo que no sabe", why: "x", action: "add", anchor: "- Responde de forma completa y detallada.", text: "- Si no sabes algo, dilo y ofrece consultarlo." },
    { what: "Mensajes cortos", why: "x", action: "replace", anchor: "- Responde de forma completa y detallada.", text: "- Responde claro y corto." },
  ];
  const want = ["Eres Lia.", "", "CÓMO ATIENDES", "- Responde claro y corto.", "- Si no sabes algo, dilo y ofrece consultarlo.", "", "DATOS", "- Horario: 9 a 18 h."].join("\n");
  assert.equal(applyProposal(base, parseProposal(edits(both))!).instructions, want);
  assert.equal(applyProposal(base, parseProposal(edits([...both].reverse()))!).instructions, want, "el orden no importa");
  // Quitar una línea y añadir tras ella: la regla queda donde estaba la línea.
  const swap = applyProposal(
    base,
    parseProposal(
      edits([
        { what: "q", why: "x", action: "remove", anchor: "- Responde de forma completa y detallada." },
        { what: "a", why: "x", action: "add", anchor: "- Responde de forma completa y detallada.", text: "- Responde corto." },
      ]),
    )!,
  );
  assert.equal(swap.instructions, ["Eres Lia.", "", "CÓMO ATIENDES", "- Responde corto.", "", "DATOS", "- Horario: 9 a 18 h."].join("\n"));
  // Dos correcciones de la misma línea: vale la primera.
  const twice = applyProposal(
    base,
    parseProposal(
      edits([
        { what: "uno", why: "x", action: "replace", anchor: "- Responde de forma completa y detallada.", text: "- Uno." },
        { what: "dos", why: "x", action: "replace", anchor: "- Responde de forma completa y detallada.", text: "- Dos." },
      ]),
    )!,
  );
  assert.match(twice.instructions, /- Uno\./);
  assert.doesNotMatch(twice.instructions, /- Dos\./);
  assert.match(twice.skipped[0]!, /ya la cambiaba otro/);
});

test("una regla nueva cuya línea de referencia no existe va al final: lo que importa es la regla", () => {
  const out = applyProposal(BASE, parseProposal(edits([{ what: "Siguiente paso", why: "x", action: "add", anchor: "Ante una objeción: reconoce y da un motivo.", text: "- Propón el siguiente paso." }]))!);
  assert.equal(out.instructions, `${BASE}\n- Propón el siguiente paso.`);
  assert.deepEqual(out.skipped, []);
});

test("los cambios conservan la viñeta del dueño aunque la IA la olvide", () => {
  const base = ["CÓMO ATIENDES", "- Responde completo.", "• Saluda siempre."].join("\n");
  const out = applyProposal(
    base,
    parseProposal(
      edits([
        { what: "Corto", why: "x", action: "replace", anchor: "Responde completo.", text: "Responde corto." },
        { what: "Paso", why: "x", action: "add", anchor: "Saluda siempre.", text: "Propón el siguiente paso." },
        { what: "Ya con viñeta", why: "x", action: "add", anchor: "Responde completo.", text: "- Una pregunta por mensaje." },
      ]),
    )!,
  );
  assert.equal(out.instructions, ["CÓMO ATIENDES", "- Responde corto.", "- Una pregunta por mensaje.", "• Saluda siempre.", "• Propón el siguiente paso."].join("\n"));
});

test("la propuesta la redacta el modelo que razona; si la clave no lo tiene, el del agente", async () => {
  const t = improve();
  const one = (await t.svc.overview("b1")).cases[0]!;
  const r = await t.svc.start("b1", { caseIds: [one.id], repetitions: 1, turns: 4, rounds: 1 });
  await t.svc.settled(r.id);
  const asks = t.calls.filter((c) => c.system === PROPOSAL_SYSTEM);
  assert.deepEqual(asks.map((c) => [c.model, c.effort]), [["gpt-5-mini", "medium"]]);

  const fallback = improve({ rejectModel: "gpt-5-mini" });
  const c = (await fallback.svc.overview("b1")).cases[0]!;
  const r2 = await fallback.svc.start("b1", { caseIds: [c.id], repetitions: 1, turns: 4, rounds: 1 });
  await fallback.svc.settled(r2.id);
  assert.deepEqual(fallback.calls.filter((x) => x.system === PROPOSAL_SYSTEM).map((x) => x.model), ["gpt-5-mini", "gpt-test"]);
  assert.equal((await fallback.svc.run("b1", r2.id)).variants[1]!.status, "done");
});

test("añadir al final no se come el salto de línea final del dueño (no aparece como línea quitada)", () => {
  const out = applyProposal("Eres Lia.\n- Saluda.\n", parseProposal(edits([{ what: "Paso", why: "x", action: "add", anchor: "", text: "- Propón el siguiente paso." }]))!);
  assert.equal(out.instructions, "Eres Lia.\n- Saluda.\n- Propón el siguiente paso.\n");
});

test("si la IA se queda sin tokens a mitad, la medición se detiene con lo que lleva y lo dice", async () => {
  const t = improve({ quotaAfter: 5 });
  const cases = (await t.svc.overview("b1")).cases.slice(0, 2);
  const r = await t.svc.start("b1", { caseIds: cases.map((c) => c.id), repetitions: 3, turns: 4, rounds: 1 });
  await t.svc.settled(r.id);
  const run = await t.svc.run("b1", r.id);
  assert.equal(run.status, "failed");
  assert.match(run.error!, /La IA dejó de responder/);
  assert.match(run.error!, /se enseña lo que llegó a medirse/);
  assert.ok(t.db.results.length < 6, `no sigue gastando: ${t.db.results.length} conversaciones`);
  assert.equal(t.asked.length, 0, "ni redacta la propuesta");
  assert.equal(run.done, run.total);

  // Un fallo puntual (no de cupo) no detiene nada: esa conversación no cuenta y las demás siguen.
  const once = improve();
  let calls = 0;
  const original = (once.svc as any).agent.simulateTurn;
  (once.svc as any).agent.simulateTurn = async (i: any, o: any) => (++calls === 1 ? { customer: null, agent: null, ended: "error", error: "El proveedor de IA no respondió en 60 s", tokens: 0 } : original(i, o));
  const c1 = (await once.svc.overview("b1")).cases[0]!;
  const r2 = await once.svc.start("b1", { caseIds: [c1.id], repetitions: 3, turns: 4, rounds: 0 });
  await once.svc.settled(r2.id);
  const run2 = await once.svc.run("b1", r2.id);
  assert.equal(run2.status, "done");
  assert.deepEqual([run2.variants[0]!.score!.conversations, run2.variants[0]!.score!.failed], [2, 1]);
});
