/**
 * Conversiones de anuncios: qué se manda a Meta y con qué identificador. Los
 * chats de un anuncio de clic a WhatsApp van con su click id (Conversions API
 * for Business Messaging); los leads de formulario, con el id del lead
 * (integración de CRM). Base de datos y Graph API simuladas.
 *
 *   npm run test:conversions --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
// El token del conjunto de datos se guarda cifrado: la clave sale del entorno.
process.env.APP_ENCRYPTION_KEY ??= "clave-de-prueba";
import { ConversionsService } from "../src/modules/conversions/conversions.service";
import { decryptSecret, encryptSecret } from "../src/common/utils/secret-box";

type Ref = Record<string, unknown> | null;
type Row = Record<string, unknown>;
/** Página de Facebook con (o sin) su conjunto de datos de Meta. */
type FormPage = { id: string; pageId: string; name: string; capiEnabled: boolean; capiDatasetId: string | null; capiTokenEnc: string | null };

/** Un id de lead de Meta de 17 cifras: no cabe en un Number de JavaScript sin redondearse. */
const LEAD_ID = "12345678901234567";
const pageOn = (): FormPage => ({ id: "mp1", pageId: "p1", name: "Mi página", capiEnabled: true, capiDatasetId: "777000111", capiTokenEnc: encryptSecret("token-del-conjunto-de-datos") });

function setup(opts: {
  messages?: { referral: Ref; channelId: string | null }[];
  conversations?: { referral: Ref; channelId: string | null }[];
  events?: { eventName: string; withValue?: boolean }[];
  deal?: { value: number | null; currency: string };
  /** El último lead de formulario del contacto, si llenó alguno. */
  lead?: { leadgenId: string; pageId: string } | null;
  /** La página de ese lead. */
  page?: FormPage | null;
}) {
  const saved: Row[] = [];
  // Una fila por oportunidad, evento y vía, como la base (único por dealId + eventName + channel).
  const rows = new Map<string, Row>();
  // «Lead» al llegar un lead de formulario: sin oportunidad, una fila por lead.
  const leadRows: Row[] = [];
  const deal = opts.deal ?? { value: 0, currency: "USD" };
  const page = opts.page ?? null;
  let seq = 0;
  // La vía por defecto es WhatsApp, como la columna: las filas de antes no la llevan.
  const keyOf = (k: { eventName: string; channel?: string }) => ((k.channel ?? "whatsapp") === "whatsapp" ? k.eventName : `${k.channel}:${k.eventName}`);
  const prisma = {
    pipelineStage: { findUnique: async () => ({ conversionEvents: opts.events ?? [{ eventName: "LeadSubmitted" }] }) },
    message: {
      findMany: async () => (opts.messages ?? []).map((m) => ({ referral: m.referral, conversation: { channelId: m.channelId } })),
    },
    conversation: { findMany: async () => opts.conversations ?? [] },
    whatsappConnection: {
      findUnique: async () => ({ id: "c1", capiEnabled: true, capiDatasetId: "ds1", wabaId: "waba1", accessToken: "tok" }),
      findMany: async () => [],
    },
    metaLead: { findFirst: async () => opts.lead ?? null },
    metaPage: {
      findUnique: async ({ where }: { where: { id?: string; pageId?: string } }) =>
        page && (where.id ? where.id === page.id : where.pageId === page.pageId) ? page : null,
      findMany: async () => (page ? [page] : []),
      update: async ({ data }: { data: Partial<FormPage> }) => Object.assign(page!, data),
    },
    conversionEvent: {
      findUnique: async ({ where }: { where: { id?: string; dealId_eventName_channel?: { eventName: string; channel: string } } }) =>
        where.id ? ([...rows.values(), ...leadRows].find((r) => r.id === where.id) ?? null) : (rows.get(keyOf(where.dealId_eventName_channel!)) ?? null),
      findFirst: async ({ where }: { where: { leadgenId?: string; eventName?: string } }) =>
        leadRows.find((r) => r.leadgenId === where.leadgenId && r.eventName === where.eventName) ?? null,
      findMany: async ({ where }: { where?: { status?: string } } = {}) =>
        [...rows.values(), ...leadRows].filter((r) => !where?.status || r.status === where.status),
      upsert: async (args: { where: { dealId_eventName_channel: { eventName: string; channel: string } }; create: Row; update: Row }) => {
        const key = keyOf(args.where.dealId_eventName_channel);
        const row = rows.has(key) ? { ...rows.get(key)!, ...args.update } : { id: `ce${++seq}`, createdAt: new Date(), ...args.create };
        rows.set(key, row);
        saved.push(row);
        return row;
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `ce${++seq}`, createdAt: new Date(), ...data };
        leadRows.push(row);
        saved.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(leadRows.find((r) => r.id === where.id)!, data),
    },
    deal: { findUnique: async () => deal },
  };
  const svc = new ConversionsService(prisma as never, { orgId: () => "o1" } as never);
  return { svc, saved, rows, leadRows, deal, page };
}

type Call = { url: string; auth: string | null; raw: string; json: { data: Array<Record<string, any>> } };

/** Lo que salió hacia Meta, con la dirección, el token y el cuerpo tal cual. `respond` decide qué contesta Meta. */
async function requests(run: () => Promise<unknown>, respond: () => Response = () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 })): Promise<Call[]> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization ?? null, raw: init.body, json: JSON.parse(init.body) });
    return respond();
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
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

test("una compra sin valor no sale con 0: queda esperando", async () => {
  const t = setup({
    conversations: [{ referral: { sourceId: "111", ctwaClid: "clid-111" }, channelId: "c1" }],
    events: [{ eventName: "Purchase", withValue: true }],
    deal: { value: null, currency: "PEN" },
  });
  const bodies = await sent(() => report(t.svc));
  assert.equal(bodies.length, 0, "Meta no recibe una compra de 0");
  assert.equal(t.rows.get("Purchase")?.status, "waiting");
});

test("al ponerle valor a la oportunidad, la compra que esperaba sale con él", async () => {
  const t = setup({
    conversations: [{ referral: { sourceId: "111", ctwaClid: "clid-111" }, channelId: "c1" }],
    events: [{ eventName: "Purchase", withValue: true }],
    deal: { value: null, currency: "PEN" },
  });
  await sent(() => report(t.svc));
  t.deal.value = 350;
  const bodies = await sent(() => t.svc.onValue({ orgId: "o1", dealId: "d1" }));
  assert.equal(bodies.length, 1);
  const ev = (bodies[0] as { data: { event_name: string; custom_data: { value: number; currency: string } }[] }).data[0]!;
  assert.equal(ev.event_name, "Purchase");
  assert.deepEqual(ev.custom_data, { currency: "PEN", value: 350 });
  assert.equal(t.rows.get("Purchase")?.status, "sent");
  // Y no se repite si vuelve a cambiar el valor.
  assert.equal((await sent(() => t.svc.onValue({ orgId: "o1", dealId: "d1" }))).length, 0);
});

test("un lead interesado no espera valor", async () => {
  const t = setup({
    conversations: [{ referral: { sourceId: "111", ctwaClid: "clid-111" }, channelId: "c1" }],
    events: [{ eventName: "LeadSubmitted" }],
    deal: { value: null, currency: "PEN" },
  });
  const bodies = await sent(() => report(t.svc));
  assert.equal(bodies.length, 1);
  assert.equal(t.rows.get("LeadSubmitted")?.status, "sent");
});

// ── Leads de formularios de Meta (Conversions API, integración de CRM) ──

test("la etapa de un lead de formulario sale a su conjunto de datos con el formato de CRM y el id del lead exacto", async () => {
  const t = setup({ lead: { leadgenId: LEAD_ID, pageId: "p1" }, page: pageOn(), events: [{ eventName: "QualifiedLead" }] });
  const before = Math.floor(Date.now() / 1000);
  const calls = await requests(() => report(t.svc));
  assert.equal(calls.length, 1, "no vino de un anuncio de WhatsApp: solo sale por el formulario");
  const call = calls[0]!;
  assert.match(call.url, /\/777000111\/events$/, "al conjunto de datos de la página");
  assert.equal(call.auth, "Bearer token-del-conjunto-de-datos", "con su token, descifrado");
  assert.ok(call.raw.includes(`"lead_id":${LEAD_ID}`), "el id del lead va como número entero, sin comillas ni redondeo");
  const ev = call.json.data[0]!;
  assert.equal(ev.event_name, "QualifiedLead");
  assert.equal(ev.action_source, "system_generated");
  assert.deepEqual(ev.custom_data, { event_source: "crm", lead_event_source: "Driony" });
  assert.equal(ev.event_id, "d1:QualifiedLead", "para que Meta no lo cuente dos veces si se reintenta");
  assert.ok(ev.event_time >= before && ev.event_time <= before + 5, "la hora del cambio de etapa, en segundos");
  const row = t.rows.get("form:QualifiedLead")!;
  assert.equal(row.status, "sent");
  assert.equal(row.channel, "form");
  assert.equal(row.leadgenId, LEAD_ID);
  assert.equal(row.metaPageId, "mp1");
  // Una vez por oportunidad y evento.
  assert.equal((await requests(() => report(t.svc))).length, 0);
});

test("al llegar un lead de formulario sale «Lead», una sola vez por lead", async () => {
  const t = setup({ page: pageOn() });
  const arrived = { orgId: "o1", contactId: "ct1", leadgenId: LEAD_ID, pageId: "p1" };
  const calls = await requests(() => t.svc.onLead(arrived));
  assert.equal(calls.length, 1);
  const ev = calls[0]!.json.data[0]!;
  assert.equal(ev.event_name, "Lead");
  assert.equal(ev.event_id, `lead:${LEAD_ID}`);
  assert.ok(calls[0]!.raw.includes(`"lead_id":${LEAD_ID}`));
  assert.equal(t.leadRows.length, 1);
  assert.equal(t.leadRows[0]!.dealId, null, "todavía no es de ninguna oportunidad");
  assert.equal(t.leadRows[0]!.status, "sent");
  assert.equal(t.leadRows[0]!.contactId, "ct1");
  assert.equal((await requests(() => t.svc.onLead(arrived))).length, 0, "si el aviso se repite, no sale otra vez");
});

test("sin conjunto de datos conectado, con las conversiones apagadas o con un id que no es de Meta no sale nada", async () => {
  const off = setup({ lead: { leadgenId: LEAD_ID, pageId: "p1" }, page: { ...pageOn(), capiEnabled: false } });
  assert.equal((await requests(() => report(off.svc))).length, 0);
  assert.equal((await requests(() => off.svc.onLead({ orgId: "o1", contactId: "ct1", leadgenId: LEAD_ID, pageId: "p1" }))).length, 0);
  assert.equal(off.saved.length, 0);

  const noToken = setup({ lead: { leadgenId: LEAD_ID, pageId: "p1" }, page: { ...pageOn(), capiTokenEnc: null } });
  assert.equal((await requests(() => report(noToken.svc))).length, 0);

  const noLead = setup({ lead: null, page: pageOn() });
  assert.equal((await requests(() => report(noLead.svc))).length, 0, "el contacto no llenó ningún formulario");

  const notMeta = setup({ lead: { leadgenId: "lg-importado", pageId: "p1" }, page: pageOn() });
  assert.equal((await requests(() => report(notMeta.svc))).length, 0, "Meta rechazaría un id que no es suyo");
});

test("la compra de un lead de formulario no espera el valor; si la oportunidad lo tiene, lo lleva", async () => {
  const bare = setup({ lead: { leadgenId: LEAD_ID, pageId: "p1" }, page: pageOn(), events: [{ eventName: "Purchase", withValue: true }], deal: { value: null, currency: "PEN" } });
  const calls = await requests(() => report(bare.svc));
  assert.equal(calls.length, 1, "es la etapa que Meta necesita: no se queda esperando");
  assert.deepEqual(calls[0]!.json.data[0]!.custom_data, { event_source: "crm", lead_event_source: "Driony" });
  assert.equal(bare.rows.get("form:Purchase")?.status, "sent");

  const valued = setup({ lead: { leadgenId: LEAD_ID, pageId: "p1" }, page: pageOn(), events: [{ eventName: "Purchase", withValue: true }], deal: { value: 350, currency: "PEN" } });
  const withValue = await requests(() => report(valued.svc));
  assert.deepEqual(withValue[0]!.json.data[0]!.custom_data, { event_source: "crm", lead_event_source: "Driony", value: 350, currency: "PEN" });
  assert.equal(valued.rows.get("form:Purchase")?.value, 350);
});

test("quien vino por un anuncio de WhatsApp y además llenó un formulario cuenta en los dos sitios", async () => {
  const t = setup({
    conversations: [{ referral: { sourceId: "111", ctwaClid: "clid-111" }, channelId: "c1" }],
    lead: { leadgenId: LEAD_ID, pageId: "p1" },
    page: pageOn(),
    events: [{ eventName: "LeadSubmitted" }],
  });
  const calls = await requests(() => report(t.svc));
  assert.equal(calls.length, 2);
  const wa = calls.find((c) => c.url.endsWith("/ds1/events"))!;
  const form = calls.find((c) => c.url.endsWith("/777000111/events"))!;
  assert.equal(wa.json.data[0]!.action_source, "business_messaging");
  assert.equal(wa.json.data[0]!.user_data.ctwa_clid, "clid-111");
  assert.equal(form.json.data[0]!.action_source, "system_generated");
  assert.equal(t.rows.get("LeadSubmitted")?.status, "sent", "la fila de WhatsApp");
  assert.equal(t.rows.get("form:LeadSubmitted")?.status, "sent", "y la del formulario, aparte");
});

test("si Meta rechaza el evento queda como fallido con su mensaje, y reintentarlo lo vuelve a enviar", async () => {
  const t = setup({ lead: { leadgenId: LEAD_ID, pageId: "p1" }, page: pageOn(), events: [{ eventName: "QualifiedLead" }] });
  const rejected = () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token - Cannot parse access token", code: 190 } }), { status: 400 });
  await requests(() => report(t.svc), rejected);
  const row = t.rows.get("form:QualifiedLead")!;
  assert.equal(row.status, "failed");
  assert.match(String(row.error), /Invalid OAuth access token/);

  const again = await requests(() => t.svc.retry(String(row.id)));
  assert.equal(again.length, 1);
  assert.ok(again[0]!.raw.includes(`"lead_id":${LEAD_ID}`), "con el mismo lead");
  assert.equal(t.rows.get("form:QualifiedLead")?.status, "sent");

  // El «Lead» inicial que falló también se puede reintentar.
  const first = setup({ page: pageOn() });
  await requests(() => first.svc.onLead({ orgId: "o1", contactId: "ct1", leadgenId: LEAD_ID, pageId: "p1" }), rejected);
  assert.equal(first.leadRows[0]!.status, "failed");
  const retried = await requests(() => first.svc.retry(String(first.leadRows[0]!.id)));
  assert.equal(retried[0]!.json.data[0]!.event_name, "Lead");
  assert.equal(first.leadRows[0]!.status, "sent");
  assert.equal(first.leadRows.length, 1, "la misma fila, no otra");
});

test("conectar el conjunto de datos guarda el token cifrado y no lo devuelve nunca", async () => {
  const t = setup({ page: { id: "mp1", pageId: "p1", name: "Mi página", capiEnabled: false, capiDatasetId: null, capiTokenEnc: null } });
  await assert.rejects(t.svc.enableForm("mp1", { datasetId: "999888777" }), /token/i, "la primera vez hace falta el token");
  const overview = await t.svc.enableForm("mp1", { datasetId: "999888777", accessToken: "EAAB-token-largo-de-prueba-0001" });
  assert.notEqual(t.page!.capiTokenEnc, "EAAB-token-largo-de-prueba-0001");
  assert.equal(decryptSecret(t.page!.capiTokenEnc!), "EAAB-token-largo-de-prueba-0001");
  assert.deepEqual(overview.forms, [{ id: "mp1", name: "Mi página", enabled: true, datasetId: "999888777", hasToken: true }]);
  assert.ok(!JSON.stringify(overview).includes("EAAB-token"), "el token no sale de la API");

  // Cambiar solo el conjunto de datos conserva el token guardado; desactivar no lo borra.
  const kept = t.page!.capiTokenEnc;
  await t.svc.enableForm("mp1", { datasetId: "111222333" });
  assert.equal(t.page!.capiTokenEnc, kept);
  assert.equal(t.page!.capiDatasetId, "111222333");
  const off = await t.svc.disableForm("mp1");
  assert.equal(off.forms[0]!.enabled, false);
  assert.equal(off.forms[0]!.hasToken, true);
  await assert.rejects(t.svc.enableForm("no-existe", { datasetId: "1" }), /no encontrada/i);
});
