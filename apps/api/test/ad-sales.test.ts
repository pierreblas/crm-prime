/**
 * Ventas por anuncio: atribución al último anuncio, cada cliente una vez, solo
 * oportunidades posteriores al clic, potenciales por etapa actual o por haber
 * pasado por una «potencial», valor en la moneda principal, lo avisado a Meta y
 * la comparación con los que no vinieron de un anuncio. Sin base de datos.
 *
 *   npm run test:adsales --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AdReferral } from "@crm/shared";
import { adKey, aggregateAdSales, dealAfter, safeUrl, type AdClick, type SalesDeal } from "../src/modules/dashboard/ad-sales";

const T0 = Date.UTC(2026, 10, 1, 12);
const at = (h: number) => new Date(T0 + h * 3600_000);

const ad = (id: string | null, headline: string | null, extra: Partial<AdReferral> = {}): AdReferral => ({
  sourceUrl: id ? `https://fb.me/${id}` : null,
  sourceId: id,
  sourceType: "ad",
  headline,
  body: null,
  mediaType: "image",
  imageUrl: null,
  videoUrl: null,
  thumbnailUrl: id ? `https://scontent.example/${id}.jpg` : null,
  ctwaClid: id ? `clid-${id}` : null,
  welcomeMessage: null,
  ref: null,
  ...extra,
});
const click = (contactId: string, h: number, referral: AdReferral, channel = "whatsapp"): AdClick => ({ contactId, at: at(h), referral, channel });
const deal = (id: string, contactId: string, o: Partial<SalesDeal> = {}): SalesDeal => ({
  id,
  contactId,
  value: null,
  currency: "USD",
  createdAt: at(1),
  stageEnteredAt: at(1),
  closedAt: null,
  isWon: false,
  isQualified: false,
  ...o,
});

const CURSO = ad("111", "Curso de genómica");
const TALLER = ad("222", "Taller de bioinformática");

test("cada cliente cuenta una vez, para el último anuncio por el que escribió", () => {
  const r = aggregateAdSales({
    period: "30d",
    clicks: [
      click("ana", 0, CURSO),
      click("ana", 5, TALLER), // Ana volvió por otro anuncio: cuenta para el taller.
      click("ana", 2, CURSO),
      click("beto", 3, CURSO, "instagram"),
    ],
    started: new Map(),
    deals: [],
    qualifiedSteps: [],
    sentDealIds: new Set(),
    fallbackCurrency: "PEN",
  });
  assert.equal(r.totals.chats, 2);
  const byKey = Object.fromEntries(r.ads.map((a) => [a.key, a]));
  assert.equal(byKey["id:222"]!.chats, 1);
  assert.equal(byKey["id:111"]!.chats, 1);
  assert.deepEqual(byKey["id:111"]!.channels, ["instagram"]);
  assert.equal(r.currency, "PEN", "sin ventas, la moneda más usada");
  assert.equal(r.totals.reportable, 2, "los dos clics traen ctwa_clid");
});

test("potenciales y ventas: solo oportunidades de después del clic, y el valor en la moneda principal", () => {
  const r = aggregateAdSales({
    period: "30d",
    clicks: [click("ana", 10, CURSO), click("beto", 10, CURSO), click("carla", 10, CURSO), click("dani", 10, TALLER)],
    started: new Map(),
    deals: [
      // Ana: compró después del clic.
      deal("d1", "ana", { createdAt: at(11), stageEnteredAt: at(30), closedAt: at(30), isWon: true, value: 50 }),
      // Beto: una venta de hace meses, de antes del clic: no es del anuncio.
      deal("d2", "beto", { createdAt: at(-2000), stageEnteredAt: at(-1900), closedAt: at(-1900), isWon: true, value: 900 }),
      // Carla: pasó por «potencial» y ahora está en otra etapa (perdida).
      deal("d3", "carla", { createdAt: at(10.5), stageEnteredAt: at(40) }),
      // Dani: compró en otra moneda.
      deal("d4", "dani", { createdAt: at(12), stageEnteredAt: at(20), closedAt: at(20), isWon: true, value: 100, currency: "PEN" }),
    ],
    qualifiedSteps: [{ dealId: "d3", at: at(15) }],
    sentDealIds: new Set(["d1"]),
    fallbackCurrency: "USD",
  });
  const curso = r.ads.find((a) => a.key === "id:111")!;
  assert.deepEqual({ chats: curso.chats, qualified: curso.qualified, won: curso.won, wonValue: curso.wonValue, sent: curso.sentToMeta }, {
    chats: 3,
    qualified: 2,
    won: 1,
    wonValue: 50,
    sent: 1,
  });
  assert.equal(r.currency, "USD", "empate de ventas por moneda: la más usada en la empresa");
  const taller = r.ads.find((a) => a.key === "id:222")!;
  assert.equal(taller.won, 1);
  assert.equal(taller.wonValue, 0, "la venta en PEN no suma en USD");
  assert.equal(r.otherCurrencies, true);
  assert.equal(r.ads[0]!.key, "id:111", "primero el que más vende");
  assert.deepEqual({ chats: r.totals.chats, qualified: r.totals.qualified, won: r.totals.won, sent: r.totals.sentToMeta }, { chats: 4, qualified: 3, won: 2, sent: 1 });
});

test("una oportunidad vieja que se mueve después del clic sí cuenta; la que no se toca, no", () => {
  const click0 = at(100);
  assert.equal(dealAfter({ createdAt: at(0), stageEnteredAt: at(120), closedAt: null }, click0), true, "cambió de etapa después");
  assert.equal(dealAfter({ createdAt: at(0), stageEnteredAt: at(0), closedAt: at(150) }, click0), true, "se cerró después");
  assert.equal(dealAfter({ createdAt: at(99.5), stageEnteredAt: at(99.5), closedAt: null }, click0), true, "la creó el primer mensaje");
  assert.equal(dealAfter({ createdAt: at(0), stageEnteredAt: at(50), closedAt: at(50) }, click0), false);
});

test("los que no vinieron de un anuncio, aparte y sin repetir a los de anuncio", () => {
  const r = aggregateAdSales({
    period: "7d",
    clicks: [click("ana", 10, CURSO)],
    started: new Map([
      ["ana", at(10)],
      ["eva", at(20)],
      ["fede", at(21)],
    ]),
    deals: [
      deal("d1", "eva", { createdAt: at(20), stageEnteredAt: at(25), closedAt: at(25), isWon: true, value: 30 }),
      deal("d2", "fede", { createdAt: at(21), isQualified: true }),
    ],
    qualifiedSteps: [],
    sentDealIds: new Set(),
    fallbackCurrency: "USD",
  });
  assert.deepEqual(r.organic, { chats: 2, qualified: 2, won: 1, wonValue: 30 });
  assert.equal(r.totals.chats, 1);
});

test("el anuncio sin id se reconoce por su titular; enlaces solo http(s)", () => {
  assert.equal(adKey(ad(null, "  Promo Verano ")), "t:promo verano");
  assert.equal(adKey(ad("9", "x")), "id:9");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,hola"), null);
  assert.equal(safeUrl("https://fb.me/abc"), "https://fb.me/abc");
  const r = aggregateAdSales({
    period: "30d",
    clicks: [
      click("ana", 1, ad(null, "Promo Verano", { sourceUrl: "javascript:alert(1)", ctwaClid: null, sourceType: "post" })),
      click("beto", 2, ad(null, "promo verano", { ctwaClid: null })),
    ],
    started: new Map(),
    deals: [],
    qualifiedSteps: [],
    sentDealIds: new Set(),
    fallbackCurrency: "USD",
  });
  assert.equal(r.ads.length, 1, "mismo titular, mismo anuncio");
  assert.equal(r.ads[0]!.chats, 2);
  assert.equal(r.ads[0]!.label, "promo verano", "el titular del clic más reciente");
  assert.equal(r.ads[0]!.sourceUrl, null);
  assert.equal(r.totals.reportable, 0, "sin ctwa_clid no se puede avisar a Meta");
});
