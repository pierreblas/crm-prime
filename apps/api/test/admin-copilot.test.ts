/**
 * Copiloto del administrador: documentación, historial, bucle de
 * herramientas y que las consultas no se salgan de la empresa ni enseñen
 * secretos.
 *
 *   npm run test:admincopilot --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { docsDir, docsIndex, loadDocs, parseDoc } from "../src/modules/ai/admin-copilot.docs";
import { AdminCopilotTools } from "../src/modules/ai/admin-copilot.tools";
import { AdminCopilotService, MAX_STEPS, toLlmHistory } from "../src/modules/ai/admin-copilot.service";
import type { LlmRequest, LlmResponse } from "../src/modules/ai/llm.types";

type Handler = (args: any) => unknown;

/** Prisma de mentira: cada modelo responde vacío salvo lo que se sobrescribe. */
function fakePrisma(over: Record<string, Record<string, Handler>> = {}) {
  return new Proxy(
    {},
    {
      get: (_, model: string) =>
        new Proxy(
          {},
          {
            get: (_, op: string) => async (args: any) => {
              const fn = over[model]?.[op];
              if (fn) return fn(args);
              if (op === "count") return 0;
              if (op === "findUnique" || op === "findFirst") return null;
              return [];
            },
          },
        ),
    },
  ) as any;
}

const settings = {
  status: async () => ({ ready: true, provider: "openai", model: "gpt-test", source: "own", saas: true, included: null }),
  // Sin IA de Driony (instalación propia): no hay preguntas gratis.
  copilotFree: async () => null,
  courtesyCreds: () => null,
} as any;
const tenant = { orgId: () => "org-1" } as any;

function toolsWith(prisma: any) {
  return new AdminCopilotTools(prisma, settings, tenant);
}

test("la documentación se indexa desde apps/web/content/docs", () => {
  const docs = loadDocs(docsDir());
  const meta = docs.find((d) => d.slug === "meta-ads");
  assert.ok(meta, `falta meta-ads en ${docsDir()}`);
  assert.equal(meta.title, "Anuncios y leads de Meta");
  assert.ok(meta.sections.includes("Lead Ads (formularios)"));
  assert.match(docsIndex(docs), /- meta-ads: Anuncios y leads de Meta \(/);

  const d = parseDoc("x", "intro\n# Título\n\n## Uno\ntexto\n### Sub\n## Dos");
  assert.equal(d.title, "Título");
  assert.deepEqual(d.sections, ["Uno", "Dos"]);
});

test("read_doc solo lee documentos de la lista, nunca rutas", async () => {
  const tools = toolsWith(fakePrisma());
  assert.match(tools.readDoc("meta-ads"), /^# Anuncios y leads de Meta/);
  for (const bad of ["../../../package", "..\\..\\.env", "/etc/passwd", "meta-ads.md"]) {
    assert.match(tools.readDoc(bad), /^No hay ningún documento/, bad);
  }
  const readDoc = tools.definitions().find((t) => t.name === "read_doc");
  assert.ok((readDoc?.input_schema as any).properties.slug.enum.includes("meta-ads"));
});

test("el historial empieza por una pregunta y junta turnos seguidos", () => {
  const h = toLlmHistory([
    { role: "assistant", content: "hola" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
    { role: "user", content: "d" },
  ]);
  assert.deepEqual(h, [
    { role: "user", content: "a\n\nb" },
    { role: "assistant", content: "c" },
    { role: "user", content: "d" },
  ]);
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `m${i}` }));
  const cut = toLlmHistory([...long, { role: "user", content: "fin" }]);
  assert.ok(cut.length <= 20);
  assert.equal(cut[0]!.role, "user");
  assert.equal(cut[cut.length - 1]!.content, "fin");
});

function fakeLlm(script: (req: LlmRequest, call: number) => LlmResponse) {
  const calls: LlmRequest[] = [];
  return {
    calls,
    llm: {
      name: "openai",
      classify: async () => ({}) as any,
      generate: async (req: LlmRequest) => {
        calls.push(structuredClone(req));
        return script(req, calls.length);
      },
    },
  };
}
const reply = (text: string): LlmResponse => ({
  stopReason: "end_turn",
  content: [{ type: "text", text }],
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "gpt-test",
});
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): LlmResponse => ({
  stopReason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "gpt-test",
});

test("consulta con herramientas y responde, contando como «admin_copilot»", async () => {
  const prisma = fakePrisma({ organization: { findUnique: () => ({ name: "Bistion" }) }, user: { findUnique: () => ({ name: "Ana", email: "a@x" }) } });
  const tools = toolsWith(prisma);
  const { llm, calls } = fakeLlm((req, n) => (n === 1 ? toolUse("t1", "read_doc", { slug: "meta-ads" }) : reply("Ve a [Formularios](/settings?tab=channels&channel=facebook).")));
  const svc = new AdminCopilotService(prisma, settings, tenant, tools, llm as any);

  const out = await svc.ask({ messages: [{ role: "user", content: "¿Cómo conecto Facebook?" }], path: "/settings?tab=tags" }, "u1");

  assert.equal(out.reply, "Ve a [Formularios](/settings?tab=channels&channel=facebook).");
  assert.deepEqual(out.consulted, ["Documentación: Anuncios y leads de Meta"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.feature === "admin_copilot"));
  assert.match(calls[0]!.systemDynamic!, /Empresa: Bistion\.[\s\S]*Ana[\s\S]*\/settings\?tab=tags/);
  assert.match(calls[0]!.system, /Solo puedes LEER/);
  const second = calls[1]!.messages;
  const result = (second[second.length - 1]!.content as any[])[0];
  assert.equal(result.type, "tool_result");
  assert.match(result.content, /^# Anuncios y leads de Meta/);
});

test("el bucle tiene tope, avisa antes del final y no repite consultas", async () => {
  const prisma = fakePrisma();
  const tools = toolsWith(prisma);
  const { llm, calls } = fakeLlm((_, n) => toolUse(`t${n}`, "team"));
  const svc = new AdminCopilotService(prisma, settings, tenant, tools, llm as any);

  const out = await svc.ask({ messages: [{ role: "user", content: "¿Quién atiende?" }] }, "u1");

  assert.equal(calls.length, MAX_STEPS);
  assert.match(out.reply, /No llegué a una respuesta/);
  assert.deepEqual(out.consulted, ["Equipo y fuentes"]);
  const results = calls[2]!.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "tool_result");
  assert.ok(results.some((b: any) => /Ya lo consultaste/.test(b.content)));
  const last = calls[MAX_STEPS - 1]!.messages;
  const nudge = (last[last.length - 1]!.content as any[]).find((b) => b.type === "text");
  assert.match(nudge.text, /Ya no puedes hacer más consultas/);
});

test("los leads de Meta se piden solo por las páginas de la empresa", async () => {
  const seen: any[] = [];
  const prisma = fakePrisma({
    metaPage: {
      findMany: () => [
        { pageId: "p1", name: "Bistion", isActive: true, subscribedAt: new Date(), tagIds: [], createDeal: false, dealStageId: null, formRules: [], source: null, template: null },
      ],
    },
    metaLead: {
      findMany: (args) => {
        seen.push(args.where);
        return [];
      },
      groupBy: (args) => {
        seen.push(args.where);
        return [];
      },
    },
  });
  const tools = toolsWith(prisma);
  const out = JSON.parse(await tools.run("meta_leads", {}));
  assert.equal(out.paginas[0].fuente, "Formulario de Facebook (automática)");
  await tools.run("find_contacts", { query: "Juan" });
  await tools.run("recent_problems", {});
  assert.ok(seen.length >= 4);
  for (const w of seen) assert.deepEqual(w.pageId, { in: ["p1"] });
});

test("las herramientas no devuelven secretos ni URLs completas", async () => {
  const prisma = fakePrisma({
    integrationSetting: {
      findFirst: () => ({ twilioAccountSid: "AC-secret-sid", twilioNumber: "+51999", voyageKeyEnc: "enc:voyage", whatsappAppId: null }),
    },
    webhookSubscription: {
      findMany: () => [
        { name: "n8n", url: "https://n8n.ejemplo.com/webhook/abc123token", isActive: true, lastStatus: 500, lastError: "HTTP 500", lastDeliveryAt: null, failedCount: 3, deliveredCount: 1 },
      ],
    },
  });
  const tools = toolsWith(prisma);
  const overview = await tools.run("account_overview", {});
  assert.doesNotMatch(overview, /AC-secret-sid|enc:voyage/);
  assert.match(overview, /"llamadasTwilio":true/);
  const problems = await tools.run("recent_problems", { days: 3 });
  assert.match(problems, /"destino":"n8n\.ejemplo\.com"/);
  assert.doesNotMatch(problems, /abc123token/);
});

test("una herramienta que falla responde con el error, sin romper la respuesta", async () => {
  const prisma = fakePrisma({ user: { findMany: () => Promise.reject(new Error("db caída")) } });
  const tools = toolsWith(prisma);
  assert.equal(await tools.run("team", {}), "Error al consultar: db caída");
  assert.match(String(await tools.run("borrar_todo", {})), /no existe/);
});

// ── Preguntas gratis (las paga Driony) ─────────────────────────

/** Ajustes de IA de mentira con un contador de preguntas gratis y el estado de la IA de la empresa. */
function freeSettings(opts: { used: number; limit?: number; ready?: boolean; full?: boolean; courtesy?: boolean }) {
  return {
    status: async () => ({
      ready: opts.ready ?? true,
      provider: "openai",
      model: "gpt-test",
      source: "included",
      saas: true,
      included: opts.full ? { full: true, exhausted: false } : null,
    }),
    copilotFree: async () => ({ used: opts.used, limit: opts.limit ?? 200, resetsAt: "2026-12-01T00:00:00.000Z" }),
    courtesyCreds: () => (opts.courtesy === false ? null : { provider: "openai", apiKey: "sk-driony", courtesy: true }),
  } as any;
}

function questionsLog() {
  const rows: any[] = [];
  const prisma = fakePrisma({
    organization: { findUnique: () => ({ name: "Bistion" }) },
    user: { findUnique: () => ({ name: "Ana", email: "a@x" }) },
    adminCopilotQuestion: { create: ({ data }: any) => (rows.push(data), data) },
  });
  return { prisma, rows };
}

test("con preguntas gratis disponibles, la respuesta la paga Driony y queda contada como gratis", async () => {
  const { prisma, rows } = questionsLog();
  const { llm, calls } = fakeLlm((_, n) => (n === 1 ? toolUse("t1", "team") : reply("Lo atiende Luis.")));
  // Aunque la IA de la empresa no esté lista (cupo gastado o sin clave), la gratis responde.
  const svc = new AdminCopilotService(prisma, freeSettings({ used: 12, ready: false, full: true }), tenant, toolsWith(prisma), llm as any);

  const out = await svc.ask({ messages: [{ role: "user", content: "¿Quién atiende?" }] }, "u1");

  assert.equal(out.reply, "Lo atiende Luis.");
  assert.equal(out.free, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.courtesy === true), "todas las llamadas de la pregunta van con la IA de Driony");
  assert.deepEqual(rows, [{ orgId: "org-1", userId: "u1", free: true }], "una pregunta, aunque fueran dos llamadas");
});

test("pasadas las gratis, la pregunta usa la IA de la empresa y no se cuenta como gratis", async () => {
  const { prisma, rows } = questionsLog();
  const { llm, calls } = fakeLlm(() => reply("Hecho."));
  const svc = new AdminCopilotService(prisma, freeSettings({ used: 200 }), tenant, toolsWith(prisma), llm as any);

  const out = await svc.ask({ messages: [{ role: "user", content: "hola" }] }, "u1");

  assert.equal(out.free, false);
  assert.equal(calls[0]!.courtesy, false);
  assert.deepEqual(rows, [{ orgId: "org-1", userId: "u1", free: false }]);
});

test("sin gratis y sin IA en la empresa, el aviso dice que se usaron las gratis y cuándo vuelven", async () => {
  const { prisma, rows } = questionsLog();
  const { llm, calls } = fakeLlm(() => reply("no debería llegar"));
  const svc = new AdminCopilotService(prisma, freeSettings({ used: 200, ready: false, full: true }), tenant, toolsWith(prisma), llm as any);

  // En desarrollo local el copiloto contesta simulado en vez de fallar: aquí se mira lo de producción.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      () => svc.ask({ messages: [{ role: "user", content: "hola" }] }, "u1"),
      (e: any) => {
        const msg = e.getResponse().message as string;
        assert.match(msg, /Ya usaste tus 200 preguntas gratis de este mes \(vuelven el 1 de diciembre\)/);
        assert.match(msg, /tokens de IA de este mes se gastaron/);
        return true;
      },
    );
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
  assert.equal(calls.length, 0);
  assert.equal(rows.length, 0, "una pregunta que no se respondió no se cuenta");
});

test("si la respuesta falla, la pregunta no gasta una de las gratis", async () => {
  const { prisma, rows } = questionsLog();
  const llm = { name: "openai", classify: async () => ({}), generate: async () => Promise.reject(new Error("OpenAI no respondió")) };
  const svc = new AdminCopilotService(prisma, freeSettings({ used: 5 }), tenant, toolsWith(prisma), llm as any);

  await assert.rejects(() => svc.ask({ messages: [{ role: "user", content: "hola" }] }, "u1"), /OpenAI no respondió/);
  assert.equal(rows.length, 0);
});

test("sin IA de Driony en el servidor (instalación propia) todo sigue como antes: la IA de la empresa, sin contador", async () => {
  const { prisma, rows } = questionsLog();
  const { llm, calls } = fakeLlm(() => reply("Hecho."));
  const svc = new AdminCopilotService(prisma, settings, tenant, toolsWith(prisma), llm as any);

  const out = await svc.ask({ messages: [{ role: "user", content: "hola" }] }, "u1");
  assert.equal(out.free, false);
  assert.equal(calls[0]!.courtesy, false);
  assert.deepEqual(rows, [{ orgId: "org-1", userId: "u1", free: false }]);
});
