// Resuelve la key de OpenAI de una empresa con el TENANCY_MODE, el
// AI_SHARED_KEYS y el AI_INCLUDED que le pase el test, en un proceso aparte
// (el modo se lee al importar). Imprime de dónde salió la key, nunca la key.
//
//   argv[2] = "db"  → la empresa tiene una key propia guardada
//   argv[2] = "none" → no tiene ninguna
//   argv[3] = conversaciones con IA de Driony este mes (por defecto 0)
//   argv[4] = gasto estimado en USD de la IA de Driony este mes (por defecto 0)
//   argv[5] = plan de la empresa (por defecto "free")
//   argv[6] = "counted" si la conversación de prueba ya contó este mes
import { AiSettingsService } from "../../src/modules/ai/ai-settings.service";
import { encryptSecret } from "../../src/common/utils/secret-box";

const propia = process.argv[2] === "db";
const conversations = Number(process.argv[3] ?? 0);
const costUsd = Number(process.argv[4] ?? 0);
const plan = process.argv[5] ?? "free";
const counted = process.argv[6] === "counted";

const row = {
  provider: "auto",
  openaiKeyEnc: propia ? encryptSecret("sk-propia-de-la-empresa") : null,
  anthropicKeyEnc: null,
  openaiModel: "gpt-4o",
  anthropicModel: "claude-opus-4-8",
  // Un gateway de la empresa: con la IA de Driony no se le puede mandar su clave.
  openaiBaseUrl: "https://gateway.de-la-empresa.example/v1",
};

const prisma = {
  aiSetting: { upsert: async () => row, update: async () => row },
  organization: { findUnique: async () => ({ plan }) },
};
const tenant = { orgId: () => "org_a" };
const usage = {
  includedUsage: async () => ({ conversations, costUsd }),
  countedThisMonth: async () => counted,
  invalidate: () => undefined,
};

const svc = new AiSettingsService(prisma as never, tenant as never, usage as never);
Promise.all([
  svc.getSettings(),
  svc.status(),
  svc.resolveFor("openai"),
  svc.resolveFor("openai", { purpose: "embeddings" }),
  svc.allowsConversation("conv_x"),
]).then(
  ([dto, status, openai, embeddings, allows]) =>
    console.log(
      JSON.stringify({
        ok: true,
        source: dto.openaiKey.source,
        active: dto.activeProvider,
        activeModel: dto.activeModel,
        platformKeys: dto.platformKeys,
        saas: dto.saas,
        ready: status.ready,
        statusSource: status.source,
        included: status.included,
        resolvedIncluded: !!openai.included,
        resolvedBaseUrl: openai.baseUrl,
        resolvedIsPlatformKey: openai.apiKey === "sk-de-la-plataforma",
        embeddingsIsPlatformKey: embeddings.apiKey === "sk-de-la-plataforma",
        allowsConversation: allows,
      }),
    ),
  (e: Error) => console.log(JSON.stringify({ ok: false, msg: e.message })),
);
