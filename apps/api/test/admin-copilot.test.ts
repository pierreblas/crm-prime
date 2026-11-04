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
