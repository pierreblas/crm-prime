/**
 * «Corregir al agente» con chats reales: qué momento se repite, el encargo a la
 * IA, lo que se le admite, y la corrección entera con el agente, la IA y la
 * base de datos simulados.
 *
 *   npm run test:correction --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { estimateCorrectionTokens, estimateImprovementTokens, startCorrectionSchema, type SimulationReviewLine } from "@crm/shared";
import { correctionRequest, CORRECTION_SYSTEM, judgeRequest, JUDGE_SYSTEM, parseCorrection, parseJudge, pickMoment, replayInput } from "../src/modules/ai/agent-correction.logic";
import { applyProposal } from "../src/modules/ai/agent-improve.logic";
import { AgentCorrectionService } from "../src/modules/ai/agent-correction.service";

const L = (who: SimulationReviewLine["who"], text: string, o: Partial<SimulationReviewLine> = {}): SimulationReviewLine => ({ who, text, consulted: [], options: [], handoff: null, ...o });
const PITCH = "Hola, soy Andrea. Power BI cuesta S/ 249 y empieza el 30 de noviembre.";
const CHAT = [
  L("auto", "Hola Ana, Power BI cuesta S/ 249. ¿Te reservo un cupo?"),
  L("customer", "Sí, me interesa"),
  L("agent", PITCH),
  L("customer", "ok"),
  L("customer", "¿cómo pago?"),
  L("agent", "Por transferencia o Yape."),
];

// ── Qué momento se repite ──────────────────────────────────────
test("se repite la respuesta que marcó la revisión, encontrada por su frase", () => {
  assert.equal(pickMoment(CHAT, [{ kind: "tone", note: "Repitió", quote: "Power BI cuesta S/ 249 y empieza" }]), 2);
  // Con varios fallos, el más grave: un dato inventado.
  assert.equal(
    pickMoment(CHAT, [
      { kind: "tone", note: "Repitió", quote: "Hola, soy Andrea" },
      { kind: "invented", note: "Yape no consta", quote: "Por transferencia o Yape" },
    ]),
    5,
  );
  // La cita es del cliente (lo que no le respondieron): la respuesta de después.
  assert.equal(pickMoment(CHAT, [{ kind: "unanswered", note: "No dijo cómo", quote: "cómo pago" }]), 5);
  // Sin frase que encontrar: la última respuesta del agente. Lo bueno no se corrige.
  assert.equal(pickMoment(CHAT, [{ kind: "no_next_step", note: "No cerró", quote: null }]), 5);
  assert.equal(pickMoment(CHAT, [{ kind: "good", note: "Bien", quote: "Hola, soy Andrea" }]), 5);
  // Sin nada del agente, o sin un cliente antes, no hay nada que repetir.
  assert.equal(pickMoment([L("customer", "Hola"), L("team", "Hola")], []), null);
  assert.equal(pickMoment([L("agent", "Hola"), L("customer", "Hola")], []), null);
});

test("el agente recibe el chat hasta ese momento, ni una línea más", () => {
  const r = replayInput(CHAT, 2)!;
  assert.deepEqual(r.history, [{ role: "assistant", content: "Hola Ana, Power BI cuesta S/ 249. ¿Te reservo un cupo?" }]);
  assert.equal(r.message, "Sí, me interesa");
  assert.equal(r.before, PITCH);
  const last = replayInput(CHAT, 5)!;
  assert.deepEqual(last.history.map((h) => h.role), ["assistant", "user", "assistant", "user"]);
  assert.equal(last.message, "¿cómo pago?");
  // Pasar el chat a una persona también es una respuesta.
  assert.match(replayInput([L("customer", "Hola"), L("agent", "", { handoff: "Pide un asesor" })], 1)!.before, /persona: Pide un asesor/);
});

// ── El encargo ─────────────────────────────────────────────────
const BASE = "Eres Andrea, asesora.\nREGLAS\n- Preséntate y da el precio en tu primer mensaje.\n- Usa search_products antes de dar un precio.";

test("la IA lee las instrucciones, cada chat con lo que se marcó y lo que pide el dueño", () => {
  const req = correctionRequest({
    instructions: BASE,
    note: "Que no repita el precio y pregunte cómo quiere pagar",
    chats: [{ lines: CHAT, moment: 2, summary: "Repitió la presentación", findings: [{ kind: "tone", note: "Repitió lo mismo", quote: "Hola, soy Andrea" }, { kind: "good", note: "Amable", quote: null }], today: "Hola, soy Andrea." }],
  });
  assert.match(req, /Preséntate y da el precio/);
  assert.match(req, /Lo que pide el dueño[\s\S]*pregunte cómo quiere pagar/);
  assert.match(req, /Chat 1/);
  assert.match(req, /ESTA ES LA RESPUESTA A CORREGIR/);
  assert.match(req, /Repitió lo mismo/);
  assert.doesNotMatch(req, /Amable/, "lo que hizo bien no es un fallo");
  assert.match(CORRECTION_SYSTEM, /"cause"/);
  assert.match(CORRECTION_SYSTEM, /catálogo o en Conocimiento/);
  assert.match(CORRECTION_SYSTEM, /nombres, teléfonos/);
  assert.match(CORRECTION_SYSTEM, /No juntes en una línea dos temas/);
  assert.match(CORRECTION_SYSTEM, /sin contar lo que hizo el agente/);
});

const answer = (chats: unknown[], edits: unknown[]) => `<chats>\n${JSON.stringify(chats)}\n</chats>\n<cambios>\n${JSON.stringify(edits)}\n</cambios>`;
const RULE = { what: "No repetir la presentación", why: "La mandó dos veces", case: null, action: "add", anchor: "- Preséntate y da el precio en tu primer mensaje.", text: "- Si ya recibió la presentación, no la repitas: pregunta cómo quiere pagar." };

test("se lee la causa de cada chat y el caso sin datos personales", () => {
  const r = parseCorrection(
    answer(
      [
        { chat: 1, cause: "instructions", note: "Faltaba la regla", title: "Ya recibió la presentación", brief: "El cliente recibió el pitch, dice que le interesa y deja el 987654321." },
        { chat: 2, cause: "data", note: "Falta la duración del curso", missing: "La duración del curso", title: "", brief: "" },
        { chat: 3, cause: "otra cosa", note: "" },
      ],
      [RULE],
    ),
  )!;
  assert.deepEqual(r.chats.map((c) => [c.chat, c.cause]), [[1, "instructions"], [2, "data"], [3, "instructions"]]);
  assert.equal(r.chats[0]!.test?.title, "Ya recibió la presentación");
  assert.doesNotMatch(r.chats[0]!.test!.brief, /987654321/);
  assert.equal(r.chats[1]!.test, null);
  assert.deepEqual(r.chats.map((c) => c.missing), [null, "La duración del curso", null]);
  assert.equal(r.edits.length, 1);
  assert.equal(parseCorrection("no sé"), null);
  // Sin la lista de chats, los cambios valen igual.
  assert.equal(parseCorrection(`<cambios>${JSON.stringify([RULE])}</cambios>`)!.edits.length, 1);
});

test("un dato del negocio solo entra si lo escribió el dueño", () => {
  const edit = { what: "Duración", why: "", caseTitle: null, action: "add" as const, anchor: "REGLAS", text: "- El curso dura 8 semanas." };
  assert.equal(applyProposal(BASE, [edit]).changes.length, 0);
  assert.match(applyProposal(BASE, [edit]).skipped[0]!, /8 semanas/);
  assert.equal(applyProposal(BASE, [edit], "Dile que el curso dura 8 semanas").changes.length, 1);
});

test("ninguna regla puede ofrecer lo que el negocio no dice que tiene: cuotas, descuentos, garantía…", () => {
  const edit = (text: string) => ({ what: "x", why: "", caseTitle: null, action: "add" as const, anchor: "REGLAS", text });
  const skipped = (text: string, allowed = "", base = BASE) => applyProposal(base, [edit(text)], allowed).skipped[0] ?? "";
  // Lo que propuso el modelo de verdad ante «está caro».
  assert.match(skipped("- Si dice que está caro, ofrece UNA salida real: pago en cuotas, la versión grabada o un curso más económico."), /cuotas/);
  for (const t of ["- Ofrécele un descuento.", "- Dile que hay garantía de devolución.", "- Invítalo a una clase gratis.", "- Puede pagar en 2 partes.", "- Menciona la beca.", "- Recuérdale que quedan las grabaciones.", "- Ofrece financiamiento."]) assert.ok(skipped(t), t);
  // Si está en sus instrucciones o lo escribió el dueño, vale.
  assert.equal(skipped("- Ofrécele pagar en cuotas.", "", `${BASE}\n- Aceptamos cuotas sin interés.`), "");
  assert.equal(skipped("- Ofrécele pagar en 2 partes.", "Que le diga que puede pagar en 2 partes"), "");
  // Prohibirlo no es ofrecerlo, y una regla de conducta normal pasa.
  assert.equal(skipped("- No ofrezcas descuentos ni cuotas."), "");
  assert.equal(skipped("- Nunca prometas una garantía."), "");
  assert.equal(skipped("- Si dice que está caro, pregúntale qué le frena y ofrece consultarlo."), "");
});

test("la comprobación dice si quedó arreglado y si inventó", () => {
  assert.deepEqual(parseJudge('{"fixed": true, "invented": false, "note": "Ya no la repite"}'), { fixed: true, invented: false, note: "Ya no la repite", missing: null });
  assert.equal(parseJudge('{"fixed": false, "invented": false, "note": "Esquiva", "missing": "La duración del curso"}')!.missing, "La duración del curso");
  assert.equal(parseJudge('{"fixed": true, "missing": "null"}')!.missing, null);
  // Solo el dato: lo que el modelo añade detrás no es para el dueño.
  assert.equal(parseJudge('{"fixed": true, "missing": "duración del curso Power BI; propondré regla para no inventar datos."}')!.missing, "duración del curso Power BI");
  // Dejar de inventar no basta: tiene que atender lo que preguntó el cliente.
  assert.match(JUDGE_SYSTEM, /contesta lo que preguntó el cliente/);
  assert.equal(parseJudge("ni idea"), null);
  assert.match(JUDGE_SYSTEM, /"fixed"/);
  const req = judgeRequest({ instructions: BASE, lines: CHAT, moment: 2, summary: "Repitió", findings: [], note: "Que pregunte cómo paga", reply: { text: "¿Transferencia o Yape?", consulted: ["search_products → 249"], handoff: null } });
  assert.match(req, /Que pregunte cómo paga/);
  assert.match(req, /¿Transferencia o Yape\?/);
  assert.match(req, /search_products/);
});

test("el gasto se dice antes y es bastante menor que simular el chat entero", () => {
  const one = estimateCorrectionTokens(6000, 1);
  // Medido con gpt-5-mini: de 10.000 a 16.000 con unas instrucciones cortas.
  const short = estimateCorrectionTokens(430, 1);
  assert.ok(short >= 12_000 && short <= 20_000, String(short));
  assert.ok(one > 20_000 && one < 40_000, String(one));
  assert.ok(one < estimateImprovementTokens(6000, 1, 3, 6, 1) / 3);
  assert.ok(estimateCorrectionTokens(6000, 4) > one * 2);
  assert.equal(startCorrectionSchema.safeParse({ reviewIds: [] }).success, false);
  assert.equal(startCorrectionSchema.safeParse({ reviewIds: Array(9).fill("x") }).success, false);
});

// ── La corrección entera ───────────────────────────────────────
type Any = Record<string, any>;
const SAID = { text: (who: string, text: string) => ({ direction: who === "customer" ? "INBOUND" : "OUTBOUND", author: who === "customer" ? "CONTACT" : "AI", type: "TEXT", content: text, transcript: null, note: null, aiRunId: who === "agent" ? "run1" : null, interactive: null }) };

function setup(o: { replies?: (prompt: string, message: string) => string; judge?: (reply: string) => Any; proposals?: string[]; reviews?: Any[]; ready?: boolean; prompt?: string } = {}) {
  const bot: Any = { id: "b1", orgId: "o1", name: "Andrea", systemPrompt: o.prompt ?? BASE, model: "gpt-4.1-mini" };
  const reviews: Any[] = o.reviews ?? [{ id: "r1", agentConfigId: "b1", conversationId: "cv1", verdict: "review", summary: "Repitió la presentación", findings: [{ kind: "tone", note: "Repitió", quote: "Hola, soy Andrea" }], status: "open", conversation: { contact: { name: "Ana", phone: "+51987654321", metadata: {} } } }];
  const corrections = new Map<string, Any>();
  const chats: Any[] = [];
  const cases: Any[] = [];
  const versions: Any[] = [];
  const asked: Any[] = [];
  const proposals = [...(o.proposals ?? [answer([{ chat: 1, cause: "instructions", note: "Faltaba", title: "Ya recibió el pitch", brief: "El cliente ya recibió la presentación y dice que le interesa." }], [RULE])])];
  let seq = 0;
  const match = (row: Any, where: Any): boolean => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));
  const prisma: Any = {
    agentConfig: { findUnique: async ({ where }: Any) => (where.id === bot.id ? bot : null), update: async ({ data }: Any) => Object.assign(bot, data) },
    conversationReview: {
      findMany: async ({ where }: Any) => reviews.filter((r) => where.id.in.includes(r.id) && r.agentConfigId === where.agentConfigId),
      updateMany: async ({ where, data }: Any) => reviews.filter((r) => where.id.in.includes(r.id)).forEach((r) => Object.assign(r, data)),
    },
    conversation: { findUnique: async () => ({ channelKind: "whatsapp" }) },
    message: { findMany: async () => [SAID.text("auto", "Hola Ana, Power BI cuesta S/ 249."), SAID.text("customer", "Sí, me interesa"), SAID.text("agent", PITCH)].reverse() },
    aiRun: { findMany: async () => [{ id: "run1", status: "COMPLETED", escalationReason: null, agentConfigId: "b1", toolCalls: [] }] },
    agentCorrection: {
      count: async ({ where }: Any) => [...corrections.values()].filter((c) => match(c, where)).length,
      create: async ({ data }: Any) => {
        const row = { id: `k${++seq}`, status: "running", note: "", prompt: "", changes: [], runId: null, done: 0, total: 0, tokens: 0, error: null, createdAt: new Date(0), finishedAt: null, appliedAt: null, ...data };
        delete row.chats;
        corrections.set(row.id, row);
        for (const c of data.chats.create) chats.push({ id: `h${++seq}`, correctionId: row.id, customer: "", before: "", today: null, after: null, outcome: "pending", note: "", caseTitle: null, caseBrief: null, missing: null, ...c });
        return row;
      },
      findFirst: async ({ where }: Any) => [...corrections.values()].find((c) => match(c, where)) ?? null,
      findUnique: async ({ where }: Any) => corrections.get(where.id) ?? null,
      update: async ({ where, data }: Any) => {
        const row = corrections.get(where.id)!;
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in (v as Any) ? row[k] + (v as Any).increment : v;
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
    agentCorrectionChat: {
      findMany: async ({ where }: Any) => chats.filter((c) => c.correctionId === where.correctionId).map((c) => ({ ...c, review: reviews.find((r) => r.id === c.reviewId), conversation: { contact: reviews.find((r) => r.id === c.reviewId)!.conversation.contact } })),
      update: async ({ where, data }: Any) => Object.assign(chats.find((c) => c.id === where.id)!, data),
    },
    agentTestCase: {
      count: async () => cases.length,
      findMany: async ({ where }: Any) => cases.filter((c) => !where.conversationId || where.conversationId.in.includes(c.conversationId)),
      create: async ({ data }: Any) => (cases.push(data), data),
    },
    agentPromptVersion: { create: async ({ data }: Any) => void versions.push(data), findMany: async () => [], deleteMany: async () => ({}) },
  };
  const agent: Any = {
    playground: async (input: Any, feature: string, opts: Any) => {
      asked.push({ input, feature, prompt: opts.systemPrompt });
      const reply = (o.replies ?? ((p: string) => (p.includes("no la repitas") ? "Perfecto, Ana. ¿Transferencia o Yape?" : PITCH)))(opts.systemPrompt, input.message);
      return { reply, simulatedActions: [], escalate: false, escalationReason: null, toolCalls: [], toolsUsed: [], options: [], inputTokens: 100, outputTokens: 20 };
    },
  };
  const requests: Any[] = [];
  const llm: Any = {
    generate: async (req: Any) => {
      requests.push(req);
      const isJudge = req.system === JUDGE_SYSTEM;
      const text = isJudge
        ? JSON.stringify((o.judge ?? ((reply: string) => ({ fixed: !reply.includes("soy Andrea"), invented: false, note: "x" })))(String(req.messages[0].content).split("## Respuesta nueva")[1]!))
        : (proposals.shift() ?? "nada");
      return { content: [{ type: "text", text }], usage: { inputTokens: 10, outputTokens: 5 }, model: "m", stopReason: "end" };
    },
  };
  const improve: Any = { start: async (botId: string, input: Any, proposal: Any) => ({ id: "run9", botId, input, proposal }) };
  const svc = new AgentCorrectionService(prisma as never, { orgId: () => "o1" } as never, agent as never, improve as never, { status: async () => ({ ready: o.ready !== false }) } as never, llm as never);
  const go = async (input: Any = { reviewIds: ["r1"], note: "" }) => {
    const c = await svc.start("b1", input as never);
    await svc.settled(c.id);
    return svc.get("b1", c.id);
  };
  return { svc, go, bot, reviews, chats, cases, versions, asked, requests, corrections };
}

test("de un chat que salió mal sale un cambio, probado en ese mismo momento", async () => {
  const t = setup();
  const c = await t.go();
  assert.equal(c.status, "ready");
  assert.match(c.prompt, /no la repitas/);
  assert.equal(c.basePrompt, BASE);
  assert.deepEqual(c.changes.map((x) => x.what), ["No repetir la presentación"]);
  const chat = c.chats[0]!;
  assert.equal(chat.outcome, "fixed");
  assert.equal(chat.contactName, "Ana");
  assert.equal(chat.customer, "Sí, me interesa");
  assert.equal(chat.before, PITCH);
  assert.equal(chat.today, PITCH);
  assert.match(chat.after!, /Transferencia o Yape/);
  assert.ok(c.tokens > 0);
  assert.equal(t.bot.systemPrompt, BASE, "nada cambia sin Aplicar");
  // Se probó con lo hablado de verdad y con el cliente de verdad (su nombre y su país), como una prueba: no se envía nada.
  assert.deepEqual(t.asked.map((a) => a.input.message), ["Sí, me interesa", "Sí, me interesa"]);
  assert.deepEqual(t.asked[0]!.input.contact, { name: "Ana", phone: "+51987654321" });
  assert.ok(t.asked.every((a) => a.feature === "improve"));
});

test("aplicar cambia al agente, guarda la versión anterior, da el chat por visto y lo añade a los casos", async () => {
  const t = setup();
  const c = await t.go();
  const done = await t.svc.apply("b1", c.id, { force: false });
  assert.equal(done.status, "applied");
  assert.match(t.bot.systemPrompt, /no la repitas/);
  assert.deepEqual(t.versions.map((v) => [v.systemPrompt, v.source]), [[BASE, "improve"]]);
  assert.equal(t.reviews[0]!.status, "done");
  assert.deepEqual(t.cases.map((x) => [x.source, x.conversationId, x.title]), [["chat", "cv1", "Ya recibió el pitch"]]);
  await assert.rejects(t.svc.apply("b1", c.id, { force: false }), /ya se aplicó/);
  // Otra corrección del mismo chat no repite el caso.
  const again = setup();
  again.cases.push({ conversationId: "cv1" });
  const c2 = await again.go();
  await again.svc.apply("b1", c2.id, { force: false });
  assert.equal(again.cases.length, 1);
});

test("si alguien cambió las instrucciones mientras tanto, no se pisan sin preguntar", async () => {
  const t = setup();
  const c = await t.go();
  t.bot.systemPrompt = `${BASE}\n- Otra regla.`;
  assert.equal((await t.svc.get("b1", c.id)).agentChanged, true);
  await assert.rejects(t.svc.apply("b1", c.id, { force: false }), /cambiaron/);
  assert.equal((await t.svc.apply("b1", c.id, { force: true })).status, "applied");
});

test("si hoy ya respondería bien, no se toca nada", async () => {
  const t = setup({ replies: () => "¿Transferencia o Yape?" });
  const c = await t.go();
  assert.equal(c.status, "nothing");
  assert.equal(c.chats[0]!.outcome, "today_ok");
  assert.equal(c.chats[0]!.today, "¿Transferencia o Yape?");
  assert.equal(t.requests.filter((r) => r.system === CORRECTION_SYSTEM).length, 0, "sin propuesta: no gasta más");
  await assert.rejects(t.svc.apply("b1", c.id, { force: false }), /no hay/i);
  // Pero si el dueño pide algo, se hace aunque hoy «responda bien».
  const asked = setup({ replies: (p) => (p.includes("no la repitas") ? "¿Transferencia o Yape?" : "Vale") });
  assert.equal((await asked.go({ reviewIds: ["r1"], note: "Que pregunte cómo paga" })).status, "ready");
});

test("aunque hoy ya responda bien, dice qué dato le falta", async () => {
  const t = setup({ replies: () => "No lo tengo a mano, lo consulto y te digo.", judge: () => ({ fixed: true, invented: false, note: "Dice que lo consulta", missing: "La duración del curso" }) });
  const c = await t.go();
  assert.equal(c.chats[0]!.outcome, "today_ok");
  assert.equal(c.chats[0]!.missing, "La duración del curso");
});

test("si le falta un dato del negocio, lo dice en vez de inventar una regla", async () => {
  const t = setup({ proposals: [answer([{ chat: 1, cause: "data", note: "Falta la duración del curso", title: "", brief: "" }], [])] });
  const c = await t.go();
  assert.equal(c.status, "nothing");
  assert.equal(c.chats[0]!.outcome, "data");
  assert.match(c.chats[0]!.note, /duración/);
});

test("si falta un dato pero hay una regla, también se prueba; y si con ella no basta, sigue siendo un dato", async () => {
  const data = (edits: unknown[]) => answer([{ chat: 1, cause: "data", note: "Falta la duración", missing: "La duración" }], edits);
  const ok = await setup({ proposals: [data([RULE])] }).go();
  assert.equal(ok.status, "ready");
  assert.equal(ok.chats[0]!.outcome, "fixed");
  assert.equal(ok.chats[0]!.missing, "La duración");
  const t = setup({ proposals: [data([{ ...RULE, text: "- Sé breve." }])] });
  const no = await t.go();
  assert.equal(no.chats[0]!.outcome, "data");
  assert.ok(no.chats[0]!.after, "enseña cómo respondería");
  assert.equal(t.requests.filter((r) => r.system === CORRECTION_SYSTEM).length, 1, "otra regla no le da el dato: no se gasta en otro intento");
});

test("además de la regla, dice qué dato faltaba", async () => {
  const t = setup({ proposals: [answer([{ chat: 1, cause: "instructions", note: "", missing: "La duración del curso" }], [RULE])] });
  const c = await t.go();
  assert.equal(c.chats[0]!.outcome, "fixed");
  assert.equal(c.chats[0]!.missing, "La duración del curso");
});

test("un cambio que ofrece lo que no existe se rechaza y se intenta otro sabiendo por qué", async () => {
  const promise = { ...RULE, text: "- Ofrécele pagar en cuotas." };
  const t = setup({ proposals: [answer([{ chat: 1, cause: "instructions" }], [promise]), answer([{ chat: 1, cause: "instructions" }], [RULE])] });
  const c = await t.go();
  assert.equal(c.status, "ready");
  assert.doesNotMatch(c.prompt, /cuotas/);
  assert.match(String(t.requests.filter((r) => r.system === CORRECTION_SYSTEM)[1]!.messages[0].content), /No valen[\s\S]*cuotas/);
  // Si el segundo tampoco vale, se dice.
  const bad = setup({ proposals: [answer([{ chat: 1, cause: "instructions" }], [promise]), answer([{ chat: 1, cause: "instructions" }], [promise])] });
  const r = await bad.go();
  assert.equal(r.status, "failed");
  assert.match(r.error!, /cuotas/);
});

test("la respuesta nueva se comprueba con las instrucciones del dueño, no con las ya cambiadas", async () => {
  const t = setup();
  await t.go();
  for (const r of t.requests.filter((x) => x.system === JUDGE_SYSTEM)) assert.doesNotMatch(String(r.messages[0].content).split("## El chat")[0]!, /no la repitas/);
});

test("si el primer cambio no basta, se intenta otro y se queda el mejor", async () => {
  const weak = { ...RULE, text: "- Sé breve." };
  const t = setup({ proposals: [answer([{ chat: 1, cause: "instructions", note: "" }], [weak]), answer([{ chat: 1, cause: "instructions", note: "" }], [RULE])] });
  const c = await t.go();
  assert.equal(c.status, "ready");
  assert.equal(c.chats[0]!.outcome, "fixed");
  assert.match(c.prompt, /no la repitas/);
  assert.doesNotMatch(c.prompt, /Sé breve/, "parte otra vez de las del dueño");
  const second = t.requests.filter((r) => r.system === CORRECTION_SYSTEM)[1]!;
  assert.match(String(second.messages[0].content), /Sé breve/, "sabe qué no funcionó");
  // Si ninguno lo arregla, se enseña igual y se dice.
  const none = setup({ proposals: [answer([{ chat: 1, cause: "instructions" }], [weak]), answer([{ chat: 1, cause: "instructions" }], [{ ...RULE, text: "- Sé amable." }])] });
  const r = await none.go();
  assert.equal(r.status, "ready");
  assert.equal(r.chats[0]!.outcome, "not_fixed");
});

test("una respuesta que arregla el fallo pero inventa un dato no cuenta como arreglada", async () => {
  const t = setup({ judge: (reply) => ({ fixed: !reply.includes("soy Andrea"), invented: reply.includes("Yape"), note: "Inventó Yape" }), proposals: [answer([{ chat: 1, cause: "instructions" }], [RULE]), "nada"] });
  const c = await t.go();
  assert.equal(c.chats[0]!.outcome, "not_fixed");
  assert.match(c.chats[0]!.note, /Inventó/);
});

test("lo que no se puede: chat bueno sin texto, de otro agente, dos a la vez o sin IA", async () => {
  const ok = setup();
  ok.reviews[0]!.verdict = "ok";
  await assert.rejects(ok.svc.start("b1", { reviewIds: ["r1"], note: "" }), /qué debió hacer/);
  assert.equal((await ok.go({ reviewIds: ["r1"], note: "Que no repita" })).status, "ready");
  await assert.rejects(setup().svc.start("b1", { reviewIds: ["r1", "otro"], note: "" }), /ya no existe/);
  await assert.rejects(setup().svc.start("nadie", { reviewIds: ["r1"], note: "" }), /Agente no encontrado/);
  await assert.rejects(setup({ prompt: " " }).svc.start("b1", { reviewIds: ["r1"], note: "" }), /instrucciones/);
  await assert.rejects(setup({ ready: false }).svc.start("b1", { reviewIds: ["r1"], note: "" }), /IA no está disponible/);
  const busy = setup();
  busy.corrections.set("z", { id: "z", status: "running" });
  await assert.rejects(busy.svc.start("b1", { reviewIds: ["r1"], note: "" }), /en marcha/);
});

test("si la IA falla, se dice y no se queda a medias", async () => {
  const t = setup({ proposals: ["no es un JSON"] });
  const c = await t.go();
  assert.equal(c.status, "failed");
  assert.match(c.error!, /propuesta/);
  const d = await t.svc.discard("b1", c.id);
  assert.equal(d.status, "discarded");
});

test("antes de aplicar se puede medir con los casos marcados del agente", async () => {
  const t = setup();
  t.cases.push({ id: "t1", isActive: true }, { id: "t2", isActive: true });
  const c = await t.go();
  const run = (await t.svc.measure("b1", c.id, { repetitions: 1 })) as never as Any;
  assert.deepEqual(run.input.caseIds, ["t1", "t2"]);
  assert.equal(run.input.rounds, 0);
  assert.match(run.proposal.prompt, /no la repitas/);
  assert.equal((await t.svc.get("b1", c.id)).runId, "run9");
});
