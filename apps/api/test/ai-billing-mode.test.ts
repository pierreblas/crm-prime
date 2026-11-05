/**
 * Modalidad de facturación de la IA (MANAGED | BYOK), historial de los ajustes
 * y lista de hosts admitidos para la URL base.
 *
 * Reglas que se comprueban:
 *  - guardar una clave pasa la empresa a BYOK; borrarla la devuelve a MANAGED;
 *    cada paso queda en el historial sin la clave en claro;
 *  - una empresa BYOK sin clave utilizable NO cae sola en la IA de Driony;
 *  - lo que solo OpenAI hace (audio, embeddings) sí usa la IA de Driony cuando
 *    la empresa tiene solo Anthropic: facturación mixta, declarada;
 *  - «Probar conexión» deja el estado de la clave (valid / invalid / exhausted);
 *  - el consumo copia la modalidad de la credencial y no duplica una respuesta;
 *  - en SaaS la URL base solo puede apuntar a hosts conocidos, por https.
 *
 *   npm run test:aibilling --workspace=apps/api
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

process.env.TENANCY_MODE = "multi";
process.env.AI_SHARED_KEYS = "";
process.env.AI_INCLUDED = "true";
process.env.AI_INCLUDED_MODEL = "";
process.env.OPENAI_API_KEY = "sk-de-la-plataforma";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_BASE_URL = "";
process.env.APP_ENCRYPTION_KEY = "clave-de-prueba-para-cifrar-secretos";
process.env.AI_ALLOWED_BASE_HOSTS = "gateway.permitido.example";

let AiSettingsService: typeof import("../src/modules/ai/ai-settings.service").AiSettingsService;
let AiUsageService: typeof import("../src/modules/ai/ai-usage.service").AiUsageService;
let http: typeof import("../src/modules/ai/ai-http");
let secrets: typeof import("../src/common/utils/secret-box");
let ctx: typeof import("../src/infra/tenant/tenant.context");

before(async () => {
  ({ AiSettingsService } = await import("../src/modules/ai/ai-settings.service"));
  ({ AiUsageService } = await import("../src/modules/ai/ai-usage.service"));
  http = await import("../src/modules/ai/ai-http");
  secrets = await import("../src/common/utils/secret-box");
  ctx = await import("../src/infra/tenant/tenant.context");
});

type Row = Record<string, unknown>;

/** Una empresa en memoria: su fila de ajustes, su historial y su consumo. */
function empresa(row: Row = {}) {
  const fila: Row = {
    provider: "auto",
    openaiKeyEnc: null,
    anthropicKeyEnc: null,
    openaiModel: "gpt-4o",
    anthropicModel: "claude-opus-4-8",
    openaiBaseUrl: null,
    billingMode: "MANAGED",
    credentialStatus: "unconfigured",
    validatedAt: null,
    rotatedAt: null,
    updatedBy: null,
    ...row,
  };
  const eventos: Row[] = [];
  const consumo: Row[] = [];
  const prisma = {
    aiSetting: {
      upsert: async () => ({ ...fila }),
      update: async ({ data }: { data: Row }) => {
        Object.assign(fila, data);
        return { ...fila };
      },
    },
    aiSettingEvent: {
      createMany: async ({ data }: { data: Row[] }) => {
        eventos.push(...data);
        return { count: data.length };
      },
      findMany: async () => [...eventos].reverse().map((e, i) => ({ id: `e${i}`, createdAt: new Date(), ...e })),
    },
    aiUsage: {
      create: async ({ data }: { data: Row }) => {
        if (data.requestId && consumo.some((u) => u.orgId === data.orgId && u.requestId === data.requestId)) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        consumo.push(data);
        return data;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: "Ana Admin", email: "ana@acme.test" }),
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, name: "Ana Admin", email: "ana@acme.test" })),
    },
    organization: { findUnique: async () => ({ plan: "pro", trialEndsAt: null }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const tenant = { orgId: () => "org_a" };
  const usage = {
    includedUsage: async () => ({ conversations: 3, costUsd: 0.01 }),
    countedThisMonth: async () => false,
  };
  const packs = {
    extra: async () => ({ remaining: 0, usedThisMonth: 0, nextExpiresAt: null }),
    consume: async () => false,
  };
  const svc = new AiSettingsService(prisma as never, tenant as never, usage as never, packs as never);
  return { svc, fila, eventos, consumo, prisma, tenant };
}

const acciones = (eventos: Row[]) => eventos.map((e) => e.action);

test("guardar una clave pasa a BYOK, queda «sin probar» y el historial no lleva la clave", async () => {
  const { svc, fila, eventos } = empresa();
  const dto = await svc.updateSettings({ openaiKey: "sk-nueva-clave-1234" }, "u_ana");

  assert.equal(dto.billingMode, "BYOK");
  assert.equal(dto.credentialStatus, "untested");
  assert.ok(dto.rotatedAt, "se anota cuándo se guardó");
  assert.deepEqual(dto.updatedBy, { id: "u_ana", name: "Ana Admin" });
  assert.equal(fila.updatedBy, "u_ana");
  assert.deepEqual(acciones(eventos).sort(), ["key_set", "mode_changed"]);
  const modo = eventos.find((e) => e.action === "mode_changed")!;
  assert.deepEqual(modo.details, { from: "MANAGED", to: "BYOK", reason: "key_set" });
  assert.equal(eventos.every((e) => e.userId === "u_ana"), true);
  const texto = JSON.stringify(eventos);
  assert.ok(!texto.includes("sk-nueva-clave-1234"), "la clave en claro nunca va al historial");
  assert.ok(texto.includes("1234"), "sí sus últimos caracteres, como en la pantalla");
});

test("cambiar la clave es key_rotated sin cambiar de modalidad; repetir la misma no deja rastro", async () => {
  const { svc, eventos } = empresa({ openaiKeyEnc: secrets.encryptSecret("sk-vieja-0000"), billingMode: "BYOK", credentialStatus: "valid" });
  await svc.updateSettings({ openaiKey: "sk-otra-9999" }, "u_ana");
  assert.deepEqual(acciones(eventos), ["key_rotated"]);
  assert.equal((await svc.getSettings()).credentialStatus, "untested", "una clave nueva vuelve a estar sin probar");

  eventos.length = 0;
  await svc.updateSettings({ openaiKey: "sk-otra-9999", openaiModel: "gpt-4o" }, "u_ana");
  assert.deepEqual(eventos, [], "nada cambió: nada que contar");
});

test("borrar la clave vuelve a MANAGED con la clave en «borrada», y queda escrito quién lo hizo", async () => {
  const { svc, eventos } = empresa({ openaiKeyEnc: secrets.encryptSecret("sk-vieja-0000"), billingMode: "BYOK", credentialStatus: "valid" });
  const dto = await svc.updateSettings({ openaiKey: "" }, "u_ana");
  assert.equal(dto.billingMode, "MANAGED");
  assert.equal(dto.credentialStatus, "revoked");
  assert.deepEqual(acciones(eventos).sort(), ["key_revoked", "mode_changed"]);
  assert.deepEqual(eventos.find((e) => e.action === "mode_changed")!.details, { from: "BYOK", to: "MANAGED", reason: "key_revoked" });
});

test("con dos claves, borrar una sigue en BYOK y no cambia la modalidad", async () => {
  const { svc, eventos } = empresa({
    openaiKeyEnc: secrets.encryptSecret("sk-a-1111"),
    anthropicKeyEnc: secrets.encryptSecret("sk-ant-2222"),
    billingMode: "BYOK",
    credentialStatus: "valid",
  });
  const dto = await svc.updateSettings({ openaiKey: "" }, "u_ana");
  assert.equal(dto.billingMode, "BYOK");
  assert.equal(dto.credentialStatus, "valid");
  assert.deepEqual(acciones(eventos), ["key_revoked"]);
});

test("proveedor, modelo y URL base cambiados dejan un solo evento, con el host y no la URL", async () => {
  const { svc, eventos, fila } = empresa();
  await svc.updateSettings({ provider: "anthropic", anthropicModel: "claude-sonnet-4-5", openaiBaseUrl: "https://gateway.permitido.example/v1/" }, "u_ana");
  assert.deepEqual(acciones(eventos), ["settings_changed"]);
  assert.deepEqual(eventos[0].details, {
    provider: { from: "auto", to: "anthropic" },
    anthropicModel: { from: "claude-opus-4-8", to: "claude-sonnet-4-5" },
    openaiBaseUrl: { from: null, to: "gateway.permitido.example" },
  });
  assert.equal(fila.openaiBaseUrl, "https://gateway.permitido.example/v1", "sin barra final");
});

test("en SaaS la URL base solo puede ir a un host admitido, por https y sin direcciones internas", async () => {
  const { svc } = empresa();
  const rechaza = (url: string, motivo: RegExp) =>
    assert.rejects(svc.updateSettings({ openaiBaseUrl: url }), motivo, url);
  await rechaza("http://api.openai.com/v1", /https/);
  await rechaza("https://10.0.0.5/v1", /IP|interno/);
  await rechaza("https://localhost:11434/v1", /IP|interno/);
  await rechaza("https://[::1]/v1", /IP|interno/);
  await rechaza("https://metadata.google.internal/v1", /IP|interno/);
  await rechaza("https://user:pw@api.openai.com/v1", /usuario/);
  await rechaza("https://evil.example/v1", /evil\.example.*AI_ALLOWED_BASE_HOSTS/);
  await rechaza("no-es-una-url", /válida/);

  assert.equal(http.providerUrlProblem("https://api.openai.com/v1"), null);
  assert.equal(http.providerUrlProblem("https://api.groq.com/openai/v1"), null);
  assert.equal(http.providerUrlProblem("https://gateway.permitido.example/v1"), null, "la lista del operador amplía la fija");
  assert.equal(http.providerUrlProblem("https://API.OpenAI.com/v1"), null, "sin distinguir mayúsculas");
});

test("aiFetch no llama a un host no admitido y convierte el timeout en un error legible", async () => {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = ((_: unknown, init?: RequestInit) => {
    llamadas++;
    return new Promise<Response>((_resolve, reject) => {
      // Un servidor que nunca contesta. El temporizador mantiene vivo el proceso
      // (el de AbortSignal.timeout no lo hace) hasta que aiFetch aborta.
      const colgado = setTimeout(() => reject(new Error("aiFetch no abortó a tiempo")), 5_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(colgado);
        reject(init.signal!.reason);
      });
    });
  }) as typeof fetch;
  try {
    await assert.rejects(http.aiFetch("https://evil.example/v1/chat", { method: "POST" }), /no se admite/);
    assert.equal(llamadas, 0, "ni se intenta");
    await assert.rejects(http.aiFetch("https://api.openai.com/v1/chat", { method: "POST" }, 20), /no respondió/);
    assert.equal(llamadas, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("qué dice un error del proveedor sobre la clave", () => {
  assert.equal(http.credentialStatusFromError(new Error("OpenAI 401: invalid api key")), "invalid");
  assert.equal(http.credentialStatusFromError(new Error("OpenAI 403: forbidden")), "invalid");
  assert.equal(http.credentialStatusFromError(Object.assign(new Error("rate limited"), { status: 429 })), "exhausted");
  assert.equal(http.credentialStatusFromError(new Error("El proveedor de IA (api.openai.com) no respondió en 60 s")), null);
  assert.equal(http.credentialStatusFromError(new Error("OpenAI 500: boom")), null);
});

test("«Probar conexión» deja el estado de la clave propia y un evento; la IA de Driony no toca ese estado", async () => {
  const { svc, fila, eventos } = empresa({ openaiKeyEnc: secrets.encryptSecret("sk-a-1111"), billingMode: "BYOK", credentialStatus: "untested" });

  await svc.recordTest({ ok: true, provider: "openai", model: "gpt-4o", latencyMs: 320, included: false }, "u_ana");
  assert.equal(fila.credentialStatus, "valid");
  assert.ok(fila.validatedAt instanceof Date);
  assert.equal(eventos.at(-1)!.action, "test_ok");

  await svc.recordTest({ ok: false, provider: "openai", model: "gpt-4o", latencyMs: 90, included: false, error: new Error("OpenAI 401: bad key") }, "u_ana");
  assert.equal(fila.credentialStatus, "invalid");
  assert.equal(eventos.at(-1)!.action, "test_failed");
  assert.equal((eventos.at(-1)!.details as Row).error, "OpenAI 401: bad key");

  await svc.recordTest({ ok: false, provider: "openai", model: "gpt-4o", latencyMs: 90, included: false, error: Object.assign(new Error("quota"), { status: 429 }) });
  assert.equal(fila.credentialStatus, "exhausted");

  fila.credentialStatus = "valid";
  await svc.recordTest({ ok: false, provider: "openai", model: "gpt-4o", latencyMs: 60_000, included: false, error: new Error("no respondió en 60 s") });
  assert.equal(fila.credentialStatus, "valid", "un fallo de red no dice nada de la clave");

  const { svc: gestionada, fila: filaG, eventos: eventosG } = empresa();
  await gestionada.recordTest({ ok: true, provider: "openai", model: "gpt-5-mini", latencyMs: 200, included: true }, "u_ana");
  assert.equal(filaG.credentialStatus, "unconfigured", "se probó la clave de Driony, no la de la empresa");
  assert.equal((eventosG[0].details as Row).included, true);
});

test("resolución: una empresa BYOK sin clave utilizable no cae sola en la IA de Driony", async () => {
  // Clave guardada que no se puede descifrar (cambió APP_ENCRYPTION_KEY, por ejemplo).
  const rota = empresa({ openaiKeyEnc: "esto-no-se-descifra", billingMode: "BYOK", credentialStatus: "valid" });
  const creds = await rota.svc.resolve();
  assert.equal(creds.provider, "fake", "el agente para con «Falta la clave de IA»");
  assert.equal(creds.billingMode, "BYOK");
  assert.equal(creds.included, undefined);
  assert.equal((await rota.svc.status()).ready, false);

  // La misma empresa en MANAGED: la IA de Driony, con su modalidad y su modelo fijo.
  const gestionada = empresa();
  const g = await gestionada.svc.resolve();
  assert.equal(g.included, true);
  assert.equal(g.billingMode, "MANAGED");
  assert.equal(g.model, "gpt-5-mini");
  assert.equal(g.baseUrl, null);

  // Con clave propia, BYOK y su estado.
  const propia = empresa({ openaiKeyEnc: secrets.encryptSecret("sk-a-1111"), billingMode: "BYOK", credentialStatus: "valid" });
  const p = await propia.svc.resolve();
  assert.equal(p.billingMode, "BYOK");
  assert.equal(p.credentialStatus, "valid");
  assert.equal(p.apiKey, "sk-a-1111");
});

test("facturación mixta declarada: con solo Anthropic, audio y embeddings van con la IA de Driony; sin ninguna clave, no", async () => {
  const soloAnthropic = empresa({ anthropicKeyEnc: secrets.encryptSecret("sk-ant-2222"), billingMode: "BYOK", credentialStatus: "valid" });
  const chat = await soloAnthropic.svc.resolve();
  assert.equal(chat.provider, "anthropic");
  assert.equal(chat.billingMode, "BYOK");
  const audio = await soloAnthropic.svc.resolveFor("openai");
  assert.equal(audio.included, true, "lo que solo OpenAI hace corre con la IA de Driony");
  assert.equal(audio.billingMode, "MANAGED", "y se registra como gasto de la plataforma");
  const embeddings = await soloAnthropic.svc.resolveFor("openai", { purpose: "embeddings" });
  assert.equal(embeddings.billingMode, "MANAGED");

  const sinNada = empresa({ billingMode: "BYOK", credentialStatus: "revoked" });
  const nada = await sinNada.svc.resolveFor("openai");
  assert.equal(nada.apiKey, null, "una empresa BYOK sin ninguna clave no recibe la de Driony");
  assert.equal(nada.billingMode, "BYOK");
});

test("el consumo copia la modalidad de la credencial y no registra dos veces la misma respuesta", async () => {
  const { prisma, consumo, tenant } = empresa();
  const usage = new AiUsageService(prisma as never, tenant as never);
  const flush = () => new Promise((r) => setTimeout(r, 20));

  await ctx.runInOrg("org_a", async () => {
    usage.record({ feature: "agent", model: "gpt-5-mini", inputTokens: 100, outputTokens: 10, conversationId: "cv1", billingMode: "MANAGED", requestId: "chatcmpl-1" });
    usage.record({ feature: "agent", model: "gpt-5-mini", inputTokens: 100, outputTokens: 10, conversationId: "cv1", billingMode: "MANAGED", requestId: "chatcmpl-1" });
    usage.record({ feature: "copilot", model: "claude-sonnet-4-5", inputTokens: 50, outputTokens: 5, billingMode: "BYOK", requestId: "msg_1" });
    usage.record({ feature: "knowledge_index", model: "text-embedding-3-small", inputTokens: 500, outputTokens: 0, billingMode: "BYOK" });
    usage.record({ feature: "knowledge_index", model: "text-embedding-3-small", inputTokens: 500, outputTokens: 0, billingMode: "BYOK" });
    usage.record({ feature: "agent", model: "fake-llm", inputTokens: 120, outputTokens: 40, billingMode: "BYOK" });
    await flush();
  });

  assert.equal(consumo.length, 4, "la respuesta repetida no se duplica; las llamadas sin id sí son dos; el simulado no cuenta");
  assert.deepEqual(
    consumo.map((u) => [u.feature, u.source, u.billingMode]),
    [
      ["agent", "platform", "MANAGED"],
      ["copilot", "own", "BYOK"],
      ["knowledge_index", "own", "BYOK"],
      ["knowledge_index", "own", "BYOK"],
    ],
  );
  assert.equal(consumo[0].orgId, "org_a");
});
