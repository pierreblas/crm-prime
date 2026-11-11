// Resuelve la key de OpenAI de una empresa con el TENANCY_MODE, el
// AI_SHARED_KEYS y el AI_INCLUDED que le pase el test, en un proceso aparte
// (el modo se lee al importar). Imprime de dónde salió la key, nunca la key.
//
//   argv[2] = "db"  → la empresa tiene una key propia guardada
//   argv[2] = "none" → no tiene ninguna
//   argv[3] = tokens gastados con la IA de Driony este mes (por defecto 0)
//   argv[4] = gasto estimado en USD de la IA de Driony este mes (por defecto 0)
//   argv[5] = plan de la empresa (por defecto "free")
//   argv[6] = "counted" si la conversación de prueba ya contó este mes
//   argv[7] = tokens extra (paquetes) que le quedan (por defecto 0)
import { AiSettingsService } from "../../src/modules/ai/ai-settings.service";
import { encryptSecret } from "../../src/common/utils/secret-box";

const propia = process.argv[2] === "db";
const tokens = Number(process.argv[3] ?? 0);
const costUsd = Number(process.argv[4] ?? 0);
const plan = process.argv[5] ?? "free";
const counted = process.argv[6] === "counted";
let extra = Number(process.argv[7] ?? 0);

const row = {
  provider: "auto",
  openaiKeyEnc: propia ? encryptSecret("sk-propia-de-la-empresa") : null,
  anthropicKeyEnc: null,
  openaiModel: "gpt-4o",
  anthropicModel: "claude-opus-4-8",
  // Un gateway de la empresa: con la IA de Driony no se le puede mandar su clave.
  openaiBaseUrl: "https://gateway.de-la-empresa.example/v1",
  // La modalidad sigue a la clave, como deja la migración.
  billingMode: propia ? "BYOK" : "MANAGED",
  credentialStatus: propia ? "untested" : "unconfigured",
  validatedAt: null,
  rotatedAt: null,
  updatedBy: null,
};

const prisma = {
  aiSetting: { upsert: async () => row, update: async () => row },
  organization: { findUnique: async () => ({ plan }) },
};
const tenant = { orgId: () => "org_a" };
const usage = {
  includedUsage: async () => ({ tokens, conversations: Math.round(tokens / 20_000), costUsd }),
  countedThisMonth: async () => counted,
  ownTokensThisMonth: async () => 0,
  invalidate: () => undefined,
};

// Como AiPacksService: lo que excede el cupo se carga a los paquetes, una sola vez.
let charged = 0;
const packs = {
  extra: async () => ({ remaining: extra, usedThisMonth: charged, nextExpiresAt: extra > 0 ? new Date(Date.now() + 86_400_000) : null }),
  settle: async (_org: string, excess: number) => {
    const take = Math.min(Math.max(0, excess) - charged, extra);
    if (take > 0) {
      extra -= take;
      charged += take;
    }
    return charged;
  },
};

const svc = new AiSettingsService(prisma as never, tenant as never, usage as never, packs as never);
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
