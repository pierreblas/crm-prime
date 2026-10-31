/**
 * Conversiones de anuncios (Conversions API for Business Messaging): qué
 * click id se manda a Meta. Base de datos y Graph API simuladas.
 *
 *   npm run test:conversions --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ConversionsService } from "../src/modules/conversions/conversions.service";

type Ref = Record<string, unknown> | null;

function setup(opts: { messages?: { referral: Ref; channelId: string | null }[]; conversations?: { referral: Ref; channelId: string | null }[] }) {
  const saved: Record<string, unknown>[] = [];
  const prisma = {
    pipelineStage: { findUnique: async () => ({ conversionEvents: [{ eventName: "LeadSubmitted" }] }) },
    message: {
      findMany: async () => (opts.messages ?? []).map((m) => ({ referral: m.referral, conversation: { channelId: m.channelId } })),
    },
    conversation: { findMany: async () => opts.conversations ?? [] },
    whatsappConnection: {
      findUnique: async () => ({ id: "c1", capiEnabled: true, capiDatasetId: "ds1", wabaId: "waba1", accessToken: "tok" }),
    },
    conversionEvent: {
      findUnique: async () => null,
      upsert: async (args: { create: Record<string, unknown> }) => {
        saved.push(args.create);
        return args.create;
      },
    },
    deal: { findUnique: async () => ({ value: 0, currency: "USD" }) },
  };
  const svc = new ConversionsService(prisma as never, { orgId: () => "o1" } as never);
  return { svc, saved };
}

async function sent(run: () => Promise<void>): Promise<unknown[]> {
  const bodies: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return bodies;
}

const report = (svc: ConversionsService) =>
  (svc as unknown as { report: (d: string, c: string, s: string) => Promise<void> }).report("d1", "ct1", "st1");

test("el click id guardado en camelCase (como lo guarda la bandeja) llega a Meta", async () => {
  const { svc, saved } = setup({ conversations: [{ referral: { sourceId: "111", ctwaClid: "clid-111" }, channelId: "c1" }] });
  const bodies = await sent(() => report(svc));
  assert.equal(bodies.length, 1, "antes se buscaba ctwa_clid y no se enviaba nada");
  const ev = (bodies[0] as { data: { user_data: { ctwa_clid: string; whatsapp_business_account_id: string }; action_source: string }[] }).data[0]!;
  assert.equal(ev.user_data.ctwa_clid, "clid-111");
  assert.equal(ev.user_data.whatsapp_business_account_id, "waba1");
  assert.equal(ev.action_source, "business_messaging");
  assert.equal(saved[0]?.status, "sent");
});

test("cuenta el último clic con click id; un anuncio de Estados (sin ctwa_clid) se salta", async () => {
  const { svc } = setup({
    messages: [
      { referral: { sourceId: "333" }, channelId: "c1" }, // Estados de WhatsApp: sin ctwa_clid
      { referral: { sourceId: "222", ctwaClid: "clid-222" }, channelId: "c1" },
    ],
    conversations: [{ referral: { sourceId: "111", ctwaClid: "clid-111" }, channelId: "c1" }],
  });
  const bodies = await sent(() => report(svc));
  const ev = (bodies[0] as { data: { user_data: { ctwa_clid: string } }[] }).data[0]!;
  assert.equal(ev.user_data.ctwa_clid, "clid-222");
});

test("sin ningún clic de anuncio no se envía nada", async () => {
  const { svc, saved } = setup({ conversations: [{ referral: { sourceId: "333" }, channelId: "c1" }] });
  const bodies = await sent(() => report(svc));
  assert.equal(bodies.length, 0);
  assert.equal(saved.length, 0);
});

test("también acepta un referral guardado con la forma de Meta (snake_case)", async () => {
  const { svc } = setup({ conversations: [{ referral: { source_id: "111", ctwa_clid: "clid-snake" }, channelId: "c1" }] });
  const bodies = await sent(() => report(svc));
  const ev = (bodies[0] as { data: { user_data: { ctwa_clid: string } }[] }).data[0]!;
  assert.equal(ev.user_data.ctwa_clid, "clid-snake");
});
