/**
 * El texto del agente antes de salir. El modelo tenía que escribir algo aunque
 * ya lo hubiera dicho con el archivo que mandó, y a un cliente le llegó
 * «(Esta respuesta está duplicada y no debería aparecer.)». Ni las notas para sí
 * mismo, ni el texto del archivo otra vez; y si no queda nada que decir, no se
 * escribe y el chat no pasa a una persona. Sin base de datos ni modelo.
 *
 *   npm run test:agentreply --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AgentActionsService } from "../src/modules/ai/agent-actions.service";
import { improveLine } from "../src/modules/ai/agent-improve.logic";
import { checkReply, NO_REPLY, NO_REPLY_RULE, REPLY_RULE } from "../src/modules/ai/agent-reply";
import { AgentService } from "../src/modules/ai/agent.service";
import { AutopilotService } from "../src/modules/ai/autopilot.service";

type Row = Record<string, any>;

const NOTE = "(Esta respuesta está duplicada y no debería aparecer.)";
const CAPTION = "Brochure oficial del programa";
const text = (t: string) => ({ stopReason: "end_turn", content: [{ type: "text", text: t }] });
const uses = (...calls: [string, Row][]) => ({
  stopReason: "tool_use",
  content: calls.map(([name, input], i) => ({ type: "tool_use", id: `${name}_${i}_${Math.random().toString(36).slice(2, 8)}`, name, input })),
});
const FILE: [string, Row] = ["send_product_file", { product: "MLOps", caption: CAPTION }];

// ── Las reglas ────────────────────────────────────────────────
test("una nota del modelo para sí mismo no es un mensaje para el cliente", () => {
  for (const note of [
    NOTE,
    "Esta respuesta está duplicada y no debería aparecer.",
    "*(Esta respuesta está duplicada y no debería aparecer.)*",
    "[No hay nada más que enviar]",
    "(Enviando el brochure…)",
    "Este mensaje no debe enviarse.",
    "Nota interna: el cliente ya tiene el brochure.",
    "(No enviar al cliente)",
    "",
    "   ",
  ]) {
    assert.deepEqual(checkReply(note, null), { kind: "note" }, note);
    assert.deepEqual(checkReply(note, [CAPTION]).kind, note.trim() ? "note" : "silent", note);
  }
  // Entre otras frases, se quita solo esa.
  assert.deepEqual(checkReply(`Listo, te envié el temario.\n\n${NOTE}\n\n¿Te separo un cupo?`, null), { kind: "text", text: "Listo, te envié el temario.\n\n¿Te separo un cupo?" });
  assert.deepEqual(checkReply("¿Te separo un cupo?\nNota interna: ya tiene el brochure", null), { kind: "text", text: "¿Te separo un cupo?" });
});

test("lo que sí es para el cliente sale tal cual", () => {
  for (const ok of [
    "¡Hola, Ana! ¿Te separo un cupo?",
    "Son 30 horas (en vivo)",
    "(Yape) o (transferencia)",
    "[Ver temario](https://flyteek.com/temario)",
    "La respuesta de la universidad no debería demorar más de 24 horas.",
    "Disculpa el mensaje repetido, ¿lo recibiste?",
    "Ese cobro no debería aparecer en tu estado de cuenta.",
    "Duración:\n(24 horas académicas)\n\n¿Te interesa?",
    "Si pagas hoy, el cliente corporativo recibe factura.",
  ]) {
    assert.deepEqual(checkReply(ok, null), { kind: "text", text: ok });
    assert.deepEqual(checkReply(ok, [CAPTION]), { kind: "text", text: ok });
  }
});

test("el texto del archivo no se escribe otra vez", () => {
  for (const same of [CAPTION, `${CAPTION}.`, `*${CAPTION}* 📄`, "BROCHURE OFICIAL DEL PROGRAMA"]) assert.deepEqual(checkReply(same, [CAPTION]), { kind: "silent" }, same);
  assert.deepEqual(checkReply(`${CAPTION}. ¿Te separo un cupo?`, [CAPTION]), { kind: "text", text: "¿Te separo un cupo?" });
  assert.deepEqual(checkReply(`${CAPTION}\n\nPerfecto, ¿te separo un cupo?`, [CAPTION]), { kind: "text", text: "Perfecto, ¿te separo un cupo?" });
  assert.deepEqual(checkReply(`${CAPTION} — ¿lo revisamos?`, [CAPTION]), { kind: "text", text: "¿lo revisamos?" });
  // Sin archivo en este turno, es una frase como otra; y una que solo lo nombra se queda.
  assert.deepEqual(checkReply(CAPTION, null), { kind: "text", text: CAPTION });
  assert.deepEqual(checkReply(CAPTION, [""]), { kind: "text", text: CAPTION }, "el archivo salió sin texto");
  const names = `Te envié el ${CAPTION} con todo el temario.`;
  assert.deepEqual(checkReply(names, [CAPTION]), { kind: "text", text: names });
});

test("«sin mensaje» vale solo si en este turno ya le llegó algo, y nunca se ve", () => {
  assert.deepEqual(checkReply(NO_REPLY, [CAPTION]), { kind: "silent" });
  assert.deepEqual(checkReply(`${NO_REPLY}.`, [""]), { kind: "silent" });
  assert.deepEqual(checkReply("sin_mensaje", [""]), { kind: "silent" });
  assert.deepEqual(checkReply(NO_REPLY, null), { kind: "note" });
  assert.deepEqual(checkReply(`¿Te separo un cupo? ${NO_REPLY}`, [CAPTION]), { kind: "text", text: "¿Te separo un cupo?" });
});

// ── La respuesta en un chat real ──────────────────────────────
function agent(opts: { replies: Row[]; mode?: string; tools?: string[]; maxIterations?: number; fails?: boolean; escalationRules?: Row | null; lead?: Row; fieldDefs?: Row[] }) {
  const calls: Row[] = [];
  const sent: Row[] = [];
  const saved: Row[] = [];
  const service = Object.create(AgentService.prototype) as AgentService & Row;
  service.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
  service.prisma = {
    conversation: {
      findUnique: async () => ({
        id: "cv1",
        contactId: "ct1",
        aiMode: opts.mode ?? "AUTOPILOT",
        channelKind: "whatsapp",
        referral: null,
        windowExpiresAt: new Date(Date.now() + 3600_000),
        contact: { id: "ct1", name: "Etza", phone: "+51987654321", metadata: {}, aiMemory: null, optIn: true, lastMessageAt: null },
      }),
    },
    productField: { findMany: async () => [] },
    customField: { findMany: async () => opts.fieldDefs ?? [] },
    // El agente lee los datos del lead abierto del contacto (su oportunidad en curso), si tiene.
    deal: { findFirst: async () => (opts.lead ? { fields: opts.lead } : null) },
    agentConfig: { findUnique: async () => ({ id: "bot1", systemPrompt: "Eres Gaby.", enabledTools: opts.tools ?? ["send_product_file"], model: "gpt-5-mini", maxIterations: 6 }) },
    message: {
      findMany: async () => [{ direction: "INBOUND", type: "TEXT", content: "Ver temario", interactive: null }],
      findFirst: async () => ({ type: "TEXT" }),
    },
    aiRun: { create: async () => ({ id: "run1" }), update: async ({ data }: Row) => saved.push(data) },
    aiToolCall: { create: async () => undefined },
  };
  service.bots = {
    resolveForConversation: async () => ({
      id: "bot1",
      name: "Ventas",
      systemPrompt: "Eres Gaby.",
      enabledTools: opts.tools ?? ["send_product_file"],
      model: "gpt-5-mini",
      effort: "medium",
      maxIterations: opts.maxIterations ?? 6,
      escalationRules: opts.escalationRules ?? null,
      monthlyTokenBudget: 0,
    }),
  };
  service.actions = {
    loadContext: async () => ({ tags: ["VIP"], productFiles: [{ product: "MLOps", files: ["Brochure"] }], productsWithImage: ["MLOps"] }),
    pendingFor: async () => [],
    summarize: (name: string) => `Hacer ${name}`,
    record: async () => undefined,
    execute: async (name: string, input: Row, _contact: string, _convo: string, ctx: Row) => {
      if (opts.fails) throw new Error("no tiene archivos cargados");
      if (name === "send_product_file") {
        sent.push({ name, input, aiRunId: ctx?.aiRunId });
        ctx?.onSent?.(String(input.caption ?? ""));
        return "Archivo enviado.";
      }
      sent.push({ name, input });
      return "Hecho.";
    },
  };
  service.aiSettings = { allowsConversation: async () => true };
  service.knowledge = { retrieve: async () => [] };
  service.bookings = { agentContextText: async () => "" };
  service.llm = {
    name: "openai",
    classify: async () => ({ intent: "compra", sentiment: "positive", urgency: "low", requiresHuman: false }),
    generate: async (req: Row) => {
      calls.push(JSON.parse(JSON.stringify(req)));
      const r = opts.replies[Math.min(calls.length - 1, opts.replies.length - 1)]!;
      return { ...r, usage: { inputTokens: 100, outputTokens: 10 }, model: "gpt-5-mini" };
    },
  };
  return { service, calls, sent, saved };
}

test("manda el brochure y no queda nada que decir: no escribe y el chat sigue con el agente", async () => {
  for (const last of [NO_REPLY, "", CAPTION]) {
    const a = agent({ replies: [uses(FILE), text(last)] });
    const r = await a.service.suggest("cv1");
    assert.equal(a.sent.length, 1);
    assert.equal(r.suggestion, null, `«${last}» no sale`);
    assert.equal(r.silent, true);
    assert.equal(r.escalate, false);
    assert.equal(a.saved.at(-1)!.status, "COMPLETED");
    assert.equal(a.calls.length, 2, "sin gastar otra llamada");
  }
  // Se lo dicen las reglas: todo le llega al cliente, y puede no escribir.
  const a = agent({ replies: [text("Hola")] });
  await a.service.suggest("cv1");
  assert.ok(a.calls[0]!.system.includes(REPLY_RULE.trim()) && a.calls[0]!.system.includes(NO_REPLY_RULE.trim()));
});

test("el caso real: después del brochure escribe una nota → se le pide una vez el mensaje y sale ese", async () => {
  const a = agent({ replies: [uses(FILE), text(NOTE), text("¿Te separo un cupo?")] });
  const r = await a.service.suggest("cv1");
  assert.equal(r.suggestion, "¿Te separo un cupo?");
  assert.equal(r.silent, false);
  assert.match(a.calls[2]!.messages.at(-1).content, /no es un mensaje para el cliente/i);
  assert.equal(a.sent.length, 1, "el archivo no se manda otra vez");
  // Si insiste, no sale nada: el cliente ya tiene su archivo y nadie tiene que entrar.
  const b = agent({ replies: [uses(FILE), text(NOTE), text(NOTE)] });
  const again = await b.service.suggest("cv1");
  assert.deepEqual([again.suggestion, again.silent, again.escalate], [null, true, false]);
  assert.equal(b.calls.length, 3, "una sola vez");
});

test("una nota sin haber mandado nada: se le pide otra vez y, si insiste, pasa a una persona sin enviarla", async () => {
  const ok = agent({ tools: [], replies: [text(NOTE), text("Hola, ¿en qué te ayudo?")] });
  assert.equal((await ok.service.suggest("cv1")).suggestion, "Hola, ¿en qué te ayudo?");
  const bad = agent({ tools: [], replies: [text(NOTE)] });
  const r = await bad.service.suggest("cv1");
  assert.deepEqual([r.suggestion, r.silent], [null, false]);
  assert.equal(bad.calls.length, 2);
  // Un archivo que no se pudo mandar no cuenta como enviado.
  const failed = agent({ fails: true, replies: [uses(FILE), text(NO_REPLY)] });
  const f = await failed.service.suggest("cv1");
  assert.deepEqual([f.suggestion, f.silent], [null, false]);
  assert.ok(!ok.calls[0]!.system.includes(NO_REPLY), "sin acciones que manden algo, no se le ofrece");
});

test("si ya pasó el chat a una persona no se le pide otro mensaje; y su nota no sale como despedida", async () => {
  for (const last of ["", "(Pasando el chat a un asesor)"]) {
    const a = agent({ tools: ["handoff_to_human"], replies: [uses(["handoff_to_human", { reason: "Quiere factura" }]), text(last)] });
    const r = await a.service.suggest("cv1");
    assert.deepEqual([r.suggestion, r.silent, r.escalate, a.calls.length], [null, false, true, 2]);
    const b = agent({ tools: ["handoff_to_human"], replies: [uses(["handoff_to_human", { reason: "Quiere factura" }]), text(last)] });
    const rb = await b.service.playground({ message: "Factura", botId: "bot1", history: [] });
    assert.deepEqual([rb.reply, rb.escalate, b.calls.length], [null, true, 2]);
  }
});

test("si repite una acción no se hace otra vez, y lo que lee el modelo sigue siendo válido", async () => {
  // Con otro texto es el mismo archivo.
  const a = agent({ replies: [uses(FILE), uses(["send_product_file", { product: "mlops ", caption: "Aquí va" }]), text("¿Te separo un cupo?")] });
  const r = await a.service.suggest("cv1");
  assert.equal(a.sent.length, 1, "un solo archivo");
  assert.equal(r.escalate, false);
  assert.equal(r.suggestion, "¿Te separo un cupo?");
  // Cada turno del modelo va una vez, y detrás de él, la respuesta de cada una de sus llamadas: si no, OpenAI lo rechaza.
  const seen = new Set<string>();
  const msgs: Row[] = a.calls.at(-1)!.messages;
  msgs.forEach((m, i) => {
    if (m.role !== "assistant" || typeof m.content === "string") return;
    const ids = m.content.filter((b: Row) => b.type === "tool_use").map((b: Row) => b.id);
    for (const id of ids) {
      assert.ok(!seen.has(id), "un turno repetido");
      seen.add(id);
    }
    assert.deepEqual(msgs[i + 1]!.content.map((b: Row) => b.tool_use_id), ids);
  });
  assert.equal(seen.size, 2);
  assert.match(msgs.at(-1)!.content[0].content, /ya lo hiciste/i);
  // Dos iguales en el mismo paso, o una repetida junto a una nueva: solo lo nuevo.
  const b = agent({ tools: ["send_product_file", "add_tag"], replies: [uses(FILE, FILE), uses(FILE, ["add_tag", { tag: "VIP" }]), text("Listo")] });
  await b.service.suggest("cv1");
  assert.deepEqual(b.sent.map((s) => s.name), ["send_product_file", "add_tag"]);
});

test("una consulta repetida se contesta con el aviso de siempre", async () => {
  const a = agent({ tools: ["search_contact"], replies: [uses(["search_contact", {}]), uses(["search_contact", {}]), text("Listo")] });
  assert.equal((await a.service.suggest("cv1")).suggestion, "Listo");
  assert.match(a.calls[2]!.messages.at(-1).content[0].content, /Ya consultaste esto/);
});

test("en copiloto siempre hay un texto que aprobar: ni se ofrece callar ni se quita el del archivo", async () => {
  const a = agent({ mode: "COPILOT", replies: [uses(FILE), text(CAPTION)] });
  const r = await a.service.suggest("cv1");
  assert.equal(a.sent.length, 0, "queda pendiente");
  assert.deepEqual([r.suggestion, r.silent], [CAPTION, false]);
  assert.ok(!a.calls[0]!.system.includes(NO_REPLY));
  const b = agent({ mode: "COPILOT", replies: [uses(FILE), text(NOTE), text("¿Te separo un cupo?")] });
  assert.equal((await b.service.suggest("cv1")).suggestion, "¿Te separo un cupo?", "la nota tampoco se sugiere");
});

test("en el último paso ya no se puede pedir otra vez: no sale la nota", async () => {
  const a = agent({ maxIterations: 2, replies: [uses(FILE), text(NOTE)] });
  const r = await a.service.suggest("cv1");
  assert.deepEqual([r.suggestion, r.silent, r.escalate], [null, true, false]);
});

// ── El envío ──────────────────────────────────────────────────
test("Autopilot: si no hay nada que decir no manda nada, no pasa el chat y no avisa a nadie", async () => {
  const did: string[] = [];
  const service = Object.create(AutopilotService.prototype) as Row;
  service.logger = { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  service.inFlight = new Set();
  service.typing = () => undefined;
  service.showTyping = async () => undefined;
  service.prisma = { conversation: { findUnique: async () => ({ id: "cv1", orgId: "o1", aiMode: "AUTOPILOT", status: "OPEN", channelId: null, contactId: "ct1", contact: { id: "ct1", name: "Etza", phone: "+51987654321" } }) } };
  service.aiSettings = { status: async () => ({ ready: true }) };
  service.messaging = { setStatus: async () => did.push("estado"), queueOutbound: async () => did.push("mensaje") };
  service.webhooks = { emit: async () => did.push("aviso") };
  service.handoff = async () => did.push("traspaso");
  service.sendReply = async () => did.push("respuesta");
  const run = async (res: Row) => {
    did.length = 0;
    service.agent = { suggest: async () => ({ runId: "run1", toolsUsed: [], options: [], windowOpen: true, escalationReason: null, ...res }) };
    await service.run("cv1");
    return [...did];
  };
  assert.deepEqual(await run({ suggestion: null, silent: true, escalate: false }), []);
  // Sin texto y sin haber mandado nada sí pasa a una persona, como siempre.
  assert.deepEqual(await run({ suggestion: null, silent: false, escalate: false }), ["aviso", "estado", "traspaso"]);
  assert.deepEqual(await run({ suggestion: null, silent: true, escalate: true, escalationReason: "Pidió una persona" }), ["aviso", "estado", "traspaso"]);
});

test("el archivo, la foto y los métodos de pago van enlazados a su respuesta: sin texto detrás también se sabe que los mandó el agente", async () => {
  const out: Row[] = [];
  const prisma = {
    product: { findFirst: async () => ({ name: "MLOps", imageUrl: "https://x.com/a.png", attributes: { brochure: "https://x.com/b.pdf" } }) },
    productField: { findMany: async () => [{ key: "brochure", label: "Brochure" }] },
    conversation: { findUnique: async () => ({ channelKind: "whatsapp" }) },
    contact: { findUnique: async () => ({ phone: "+51987654321" }) },
  };
  const messaging = { queueOutbound: async (input: Row, author: string, o: Row) => void out.push({ type: input.type, author, o }) };
  const svc = new AgentActionsService(prisma as never, { orgId: () => "org1" } as never, messaging as never, { emit: () => true } as never, {} as never, {} as never) as AgentActionsService & Row;
  (svc as Row).checkLink = async () => ({ ok: true, mimeType: "application/pdf", kind: "DOCUMENT" });
  (svc as Row).planPaymentMethods = async () => ({ text: "Yape 999", images: [], names: ["Yape"], country: null, problem: null });
  const texts: string[] = [];
  const ctx = { aiRunId: "run1", onSent: (t: string) => void texts.push(t) };
  const result = await svc.execute("send_product_file", { product: "MLOps", caption: CAPTION }, "ct1", "cv1", ctx);
  await svc.execute("send_product_image", { product: "MLOps" }, "ct1", "cv1", ctx);
  await svc.execute("send_payment_methods", {}, "ct1", "cv1", ctx);
  assert.deepEqual(out, ["DOCUMENT", "IMAGE", "TEXT"].map((type) => ({ type, author: "AI", o: { aiRunId: "run1" } })));
  assert.deepEqual(texts, [CAPTION, "", "Yape 999"]);
  // Al modelo se le dice que el texto ya llegó.
  assert.match(result, new RegExp(CAPTION));
  // Sin métodos para su país no se mandó nada.
  texts.length = 0;
  (svc as Row).planPaymentMethods = async () => ({ text: "", images: [], names: [], country: null, problem: "No hay métodos para su país." });
  await svc.execute("send_payment_methods", {}, "ct1", "cv1", ctx);
  assert.deepEqual(texts, []);
});

// ── La prueba y el simulador ──────────────────────────────────
test("en la prueba igual: sin texto, dice qué mandó y la conversación sigue", async () => {
  const a = agent({ replies: [uses(FILE), text(NO_REPLY)] });
  const r = await a.service.playground({ message: "Ver temario", botId: "bot1", history: [] });
  assert.deepEqual([r.reply, r.silent, r.sent, r.escalate], [null, true, CAPTION, false]);
  assert.equal(improveLine(r).text, CAPTION, "el revisor lee lo que le llegó");
  // La nota tampoco sale en la prueba.
  const b = agent({ replies: [uses(FILE), text(NOTE), text("¿Te separo un cupo?")] });
  const rb = await b.service.playground({ message: "Ver temario", botId: "bot1", history: [] });
  assert.deepEqual([rb.reply, rb.silent], ["¿Te separo un cupo?", false]);
  // Un archivo sin texto.
  const c = agent({ replies: [uses(["send_product_file", { product: "MLOps" }]), text("")] });
  assert.equal((await c.service.playground({ message: "Ver temario", botId: "bot1", history: [] })).sent, "[documento]");
});

// ── Los seguimientos ──────────────────────────────────────────
test("un seguimiento que es una nota no se manda", async () => {
  const draft = async (t: string) => {
    const a = agent({ tools: [], replies: [text(t)] });
    a.service.followUpFacts = async () => "";
    return a.service.draftFollowUp("cv1", "Pregúntale si pudo ver el temario");
  };
  assert.equal(await draft("(No hay nada más que decir.)"), null);
  assert.equal(await draft("Hola, ¿pudiste ver el temario?"), "Hola, ¿pudiste ver el temario?");
});

test("el agente recibe lo que el cliente respondió en el formulario de su lead abierto", async () => {
  const a = agent({
    replies: [text("Hola")],
    lead: { experiencia: "no_tengo_experiencia_previa", cual_es_tu_objetivo: "conseguir_trabajo" },
    fieldDefs: [{ key: "experiencia", label: "Experiencia" }],
  });
  await a.service.suggest("cv1");
  // Lo propio de cada contacto viaja aparte de las reglas fijas (que el proveedor guarda en caché).
  const system = String(a.calls[0]!.systemDynamic);
  assert.match(system, /Datos de este lead/);
  assert.ok(system.includes("Experiencia: no_tengo_experiencia_previa"), "con el nombre del campo");
  assert.ok(system.includes("Cual es tu objetivo: conseguir_trabajo"), "y lo que aún no tiene campo, con la clave en limpio");

  // Sin lead abierto, ni se menciona.
  const b = agent({ replies: [text("Hola")] });
  await b.service.suggest("cv1");
  assert.ok(!String(b.calls[0]!.systemDynamic).includes("Datos de este lead"));
});
