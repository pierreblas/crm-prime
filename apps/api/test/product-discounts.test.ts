/**
 * Descuentos de producto: lo que devuelve la API, lo que mandan las tiendas,
 * el barrido de vencidos y lo que lee el agente. El cálculo en sí (qué precio
 * rige, porcentaje, vencimiento) está en money.test.ts. Sin base de datos.
 *
 *   npm run test:discounts --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toProductDto } from "../src/modules/products/product-catalog.service";
import { assertPriceDiscounts, resolveDiscount } from "../src/modules/products/product-discount";
import { ProductDiscountsService } from "../src/modules/products/product-discounts.service";
import { shopifyDiscount } from "../src/modules/products/connectors/shopify.connector";
import { wooDiscount } from "../src/modules/products/connectors/woocommerce.connector";
import { mercadoLibreDiscount } from "../src/modules/products/connectors/mercadolibre.connector";
import { sameAsStore } from "../src/modules/products/product-sync.service";
import { agentPrice } from "../src/modules/ai/product-agent-price";
import { followUpDraftAsk } from "../src/modules/ai/follow-up.rules";
import { AgentService } from "../src/modules/ai/agent.service";
import { parseProductListQuery, productListQueryToParams, countProductFilters } from "@crm/shared";

const FUTURE = new Date(Date.now() + 5 * 86_400_000);
const PAST = new Date(Date.now() - 1_000);

const row = (o: Record<string, unknown> = {}) =>
  ({
    id: "p1",
    name: "Curso",
    sku: null,
    description: null,
    price: 40,
    regularPrice: 50,
    saleEndsAt: FUTURE,
    currency: "USD",
    prices: [
      { currency: "EUR", amount: 37, regularAmount: null },
      { currency: "PEN", amount: 150, regularAmount: 190 },
    ],
    attributes: {},
    imageUrl: null,
    isActive: true,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    source: null,
    ...o,
  }) as never;

test("la API devuelve el precio de hoy, el de antes, el porcentaje y la fecha, también por moneda", () => {
  const dto = toProductDto(row());
  assert.deepEqual(
    { price: dto.price, regularPrice: dto.regularPrice, discountPercent: dto.discountPercent, saleEndsAt: dto.saleEndsAt },
    { price: 40, regularPrice: 50, discountPercent: 20, saleEndsAt: FUTURE.toISOString() },
  );
  assert.deepEqual(dto.prices, [
    { currency: "EUR", amount: 37, regularAmount: null },
    { currency: "PEN", amount: 150, regularAmount: 190 },
  ]);
});

test("un descuento vencido sale ya como precio normal, sin esperar al barrido", () => {
  const dto = toProductDto(row({ saleEndsAt: PAST }));
  assert.deepEqual(
    { price: dto.price, regularPrice: dto.regularPrice, discountPercent: dto.discountPercent, saleEndsAt: dto.saleEndsAt },
    { price: 50, regularPrice: null, discountPercent: null, saleEndsAt: null },
  );
  assert.deepEqual(dto.prices, [
    { currency: "EUR", amount: 37, regularAmount: null },
    { currency: "PEN", amount: 190, regularAmount: null },
  ]);
});

test("un producto sin descuento sale como siempre", () => {
  const dto = toProductDto(row({ price: 50, regularPrice: null, saleEndsAt: null, prices: [{ currency: "PEN", amount: 190, regularAmount: null }] }));
  assert.deepEqual({ price: dto.price, regularPrice: dto.regularPrice, discountPercent: dto.discountPercent, saleEndsAt: dto.saleEndsAt }, { price: 50, regularPrice: null, discountPercent: null, saleEndsAt: null });
  assert.deepEqual(dto.prices, [{ currency: "PEN", amount: 190, regularAmount: null }]);
});

// ── Al guardar ─────────────────────────────────────────────────
const saved = { price: 40, regularPrice: 50, saleEndsAt: FUTURE };

test("al guardar: poner, cambiar y quitar un descuento", () => {
  // Producto nuevo con descuento y fecha.
  assert.deepEqual(resolveDiscount({ price: 40, regularPrice: 50, saleEndsAt: FUTURE.toISOString() }, null), { regularPrice: 50, saleEndsAt: FUTURE });
  // Sin descuento.
  assert.deepEqual(resolveDiscount({ price: 50 }, null), { regularPrice: null, saleEndsAt: null });
  // Se borra el precio con descuento: vuelve al normal y se borra la fecha.
  assert.deepEqual(resolveDiscount({ price: 50, regularPrice: null }, saved), { regularPrice: null, saleEndsAt: null });
  // Solo cambia la fecha: el descuento sigue.
  const later = new Date(Date.now() + 9 * 86_400_000);
  assert.deepEqual(resolveDiscount({ saleEndsAt: later.toISOString() }, saved), { regularPrice: 50, saleEndsAt: later });
  // Se quita la fecha: descuento sin fin.
  assert.deepEqual(resolveDiscount({ saleEndsAt: null }, saved), { regularPrice: 50, saleEndsAt: null });
});

test("al guardar: lo que no es un descuento se rechaza con su motivo", () => {
  assert.throws(() => resolveDiscount({ price: 50, regularPrice: 50 }, null), /El precio con descuento debe ser menor que el precio normal/);
  assert.throws(() => resolveDiscount({ price: 60, regularPrice: 50 }, saved), /menor que el precio normal/);
  assert.throws(() => resolveDiscount({ price: 50, saleEndsAt: FUTURE.toISOString() }, null), /Pon el precio normal para usar una fecha de fin/);
  assert.throws(() => resolveDiscount({ price: 40, regularPrice: 50, saleEndsAt: PAST.toISOString() }, null), /La fecha de fin del descuento ya pasó/);
});

test("al guardar: quien no habla de descuentos no rompe nada", () => {
  // Cambia otra cosa (el nombre): el descuento queda como estaba, aunque su fecha ya haya pasado.
  assert.deepEqual(resolveDiscount({}, saved), { regularPrice: 50, saleEndsAt: FUTURE });
  assert.deepEqual(resolveDiscount({}, { ...saved, saleEndsAt: PAST }), { regularPrice: 50, saleEndsAt: PAST });
  // Un sistema externo solo manda el precio nuevo: si sigue por debajo del normal, sigue rebajado…
  assert.deepEqual(resolveDiscount({ price: 45 }, saved), { regularPrice: 50, saleEndsAt: FUTURE });
  // …y si lo iguala o lo supera, ya no hay descuento (no un error que le rompa la sincronización).
  assert.deepEqual(resolveDiscount({ price: 50 }, saved), { regularPrice: null, saleEndsAt: null });
  assert.deepEqual(resolveDiscount({ price: 60 }, saved), { regularPrice: null, saleEndsAt: null });
});

test("al guardar: un precio nuevo sobre un descuento ya vencido manda, y el barrido no lo pisará después", () => {
  const expired = { price: 40, regularPrice: 50, saleEndsAt: PAST };
  // Un ERP manda solo el precio: el descuento vencido se limpia y queda su precio (antes seguía
  // guardado y el barrido lo devolvía a 50, pisando el precio nuevo).
  assert.deepEqual(resolveDiscount({ price: 45 }, expired), { regularPrice: null, saleEndsAt: null });
  assert.deepEqual(resolveDiscount({ price: 60 }, expired), { regularPrice: null, saleEndsAt: null });
  // Sin tocar el precio (cambia el nombre), el vencido se deja al barrido: quitarlo aquí dejaría el producto al precio rebajado.
  assert.deepEqual(resolveDiscount({}, expired), { regularPrice: 50, saleEndsAt: PAST });
  // Volver a declarar el descuento sin fecha no hereda la fecha vencida (nacería ya vencido).
  assert.deepEqual(resolveDiscount({ price: 40, regularPrice: 50 }, expired), { regularPrice: 50, saleEndsAt: null });
  // Alargar la fecha de uno vencido lo reactiva.
  const later = new Date(Date.now() + 3 * 86_400_000);
  assert.deepEqual(resolveDiscount({ saleEndsAt: later.toISOString() }, expired), { regularPrice: 50, saleEndsAt: later });
});

test("al guardar: el descuento de cada otra moneda también tiene que serlo", () => {
  assert.doesNotThrow(() => assertPriceDiscounts([{ currency: "PEN", amount: 150, regularAmount: 190 }, { currency: "EUR", amount: 37 }, { currency: "MXN", amount: 700, regularAmount: null }]));
  assert.throws(() => assertPriceDiscounts([{ currency: "PEN", amount: 190, regularAmount: 190 }]), /menor que el precio normal \(PEN\)/);
});

test("filtro «Con descuento» en la lista: va y vuelve por la URL y cuenta como filtro", () => {
  const q = parseProductListQuery(new URLSearchParams("discount=1"));
  assert.equal(q.discount, true);
  assert.equal(countProductFilters(q), 1);
  assert.equal(productListQueryToParams(q).get("discount"), "1");
  const none = parseProductListQuery(new URLSearchParams(""));
  assert.equal(none.discount, false);
  assert.equal(productListQueryToParams(none).has("discount"), false);
});

// ── Barrido de vencidos ────────────────────────────────────────
function sweepSetup() {
  const products = [
    { id: "vencido", orgId: "orgA", price: 40, regularPrice: 50, saleEndsAt: PAST },
    { id: "vigente", orgId: "orgA", price: 40, regularPrice: 50, saleEndsAt: FUTURE },
    { id: "sinfecha", orgId: "orgA", price: 40, regularPrice: 50, saleEndsAt: null },
    { id: "otra", orgId: "orgB", price: 80, regularPrice: 100, saleEndsAt: PAST },
  ] as { id: string; orgId: string; price: number; regularPrice: number | null; saleEndsAt: Date | null }[];
  const prices = [
    { id: "pen", productId: "vencido", currency: "PEN", amount: 150, regularAmount: 190 },
    { id: "eur", productId: "vencido", currency: "EUR", amount: 37, regularAmount: null },
    { id: "pen2", productId: "vigente", currency: "PEN", amount: 150, regularAmount: 190 },
  ] as { id: string; productId: string; currency: string; amount: number; regularAmount: number | null }[];
  const prisma = {
    product: {
      findMany: async ({ where, take }: { where: { saleEndsAt: { lte: Date } }; take: number }) =>
        products.filter((x) => x.saleEndsAt && x.saleEndsAt.getTime() <= where.saleEndsAt.lte.getTime()).slice(0, take),
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(products.find((x) => x.id === where.id)!, data),
    },
    productPrice: {
      findMany: async ({ where }: { where: { productId: string } }) => prices.filter((x) => x.productId === where.productId && x.regularAmount != null),
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(prices.find((x) => x.id === where.id)!, data),
    },
  };
  return { svc: new ProductDiscountsService(prisma as never), products, prices };
}

test("barrido: lo vencido vuelve a su precio normal; lo vigente y lo que no tiene fecha no se toca", async () => {
  const { svc, products, prices } = sweepSetup();
  assert.equal(await svc.sweep(), 2);
  const by = Object.fromEntries(products.map((x) => [x.id, x]));
  assert.deepEqual({ price: Number(by.vencido!.price), regularPrice: by.vencido!.regularPrice, saleEndsAt: by.vencido!.saleEndsAt }, { price: 50, regularPrice: null, saleEndsAt: null });
  assert.deepEqual({ price: Number(by.otra!.price), regularPrice: by.otra!.regularPrice, saleEndsAt: by.otra!.saleEndsAt }, { price: 100, regularPrice: null, saleEndsAt: null });
  assert.deepEqual({ price: by.vigente!.price, regularPrice: by.vigente!.regularPrice }, { price: 40, regularPrice: 50 });
  assert.deepEqual({ price: by.sinfecha!.price, regularPrice: by.sinfecha!.regularPrice }, { price: 40, regularPrice: 50 });
  // Sus otras monedas: la rebajada vuelve a su normal, la que no tenía descuento no cambia.
  const px = Object.fromEntries(prices.map((x) => [x.id, x]));
  assert.deepEqual({ amount: Number(px.pen!.amount), regularAmount: px.pen!.regularAmount }, { amount: 190, regularAmount: null });
  assert.deepEqual({ amount: px.eur!.amount, regularAmount: px.eur!.regularAmount }, { amount: 37, regularAmount: null });
  assert.deepEqual({ amount: px.pen2!.amount, regularAmount: px.pen2!.regularAmount }, { amount: 150, regularAmount: 190 }, "la del producto vigente sigue rebajada");
  // Ya no queda nada vencido.
  assert.equal(await svc.sweep(), 0);
});

// ── Lo que mandan las tiendas ──────────────────────────────────
const NONE = { regularPrice: null, saleEndsAt: null };

test("Shopify: el precio de antes es compareAtPrice, solo si es mayor", () => {
  assert.deepEqual(shopifyDiscount({ price: "40.00", compareAtPrice: "50.00" }), { regularPrice: 50, saleEndsAt: null });
  for (const compareAtPrice of [null, "40.00", "30.00", "0", ""]) {
    assert.deepEqual(shopifyDiscount({ price: "40.00", compareAtPrice }), NONE, `compareAtPrice ${JSON.stringify(compareAtPrice)}`);
  }
});

test("WooCommerce: regular_price cuando hay oferta, con su fecha de fin", () => {
  assert.deepEqual(wooDiscount({ price: "40", regular_price: "50", date_on_sale_to_gmt: "2026-11-30T23:59:59" }), {
    regularPrice: 50,
    saleEndsAt: new Date("2026-11-30T23:59:59Z"),
  });
  assert.deepEqual(wooDiscount({ price: "40", regular_price: "50", date_on_sale_to_gmt: null }), { regularPrice: 50, saleEndsAt: null });
  // Sin oferta (los dos iguales), aunque quede una fecha de una oferta pasada o futura.
  assert.deepEqual(wooDiscount({ price: "50", regular_price: "50", date_on_sale_to_gmt: "2026-11-30T23:59:59" }), NONE);
  assert.deepEqual(wooDiscount({ price: "50", regular_price: "" }), NONE);
  assert.deepEqual(wooDiscount({ regular_price: "50" }), NONE, "sin price se usa regular_price como precio: sin descuento");
});

test("Mercado Libre: el precio de antes es original_price", () => {
  assert.deepEqual(mercadoLibreDiscount({ price: 40, original_price: 50 }), { regularPrice: 50, saleEndsAt: null });
  assert.deepEqual(mercadoLibreDiscount({ price: 40, original_price: null }), NONE);
  assert.deepEqual(mercadoLibreDiscount({ price: 40 }), NONE);
  assert.deepEqual(mercadoLibreDiscount({ price: 50, original_price: 50 }), NONE);
});

test("sincronización: si cambia el descuento de la tienda, el producto se vuelve a escribir", () => {
  const item = { externalId: "1", name: "Curso", sku: null, description: null, price: 40, currency: "USD", imageUrl: null, isActive: true, attributes: {}, regularPrice: 50, saleEndsAt: FUTURE };
  const stored = { id: "p1", externalId: "1", name: "Curso", sku: null, description: null, price: 40, regularPrice: 50, saleEndsAt: FUTURE, currency: "USD", imageUrl: null, isActive: true, attributes: {} };
  assert.equal(sameAsStore(stored as never, item, {}), true, "igual: no se escribe");
  assert.equal(sameAsStore({ ...stored, regularPrice: null, saleEndsAt: null } as never, item, {}), false, "la tienda puso una oferta");
  assert.equal(sameAsStore(stored as never, { ...item, regularPrice: null, saleEndsAt: null }, {}), false, "la tienda quitó la oferta");
  assert.equal(sameAsStore(stored as never, { ...item, saleEndsAt: new Date(FUTURE.getTime() + 86_400_000) }, {}), false, "cambió la fecha");
  // Un precio de antes que no es descuento (igual al precio) cuenta como «sin oferta».
  assert.equal(sameAsStore({ ...stored, regularPrice: null, saleEndsAt: null } as never, { ...item, regularPrice: 40 }, {}), true);
});

// ── Lo que lee y dice el agente ────────────────────────────────
const LIMA = "America/Lima";
// Las 23:59 del 30 de noviembre en Lima: ya es 1 de diciembre en UTC.
const END_NOV_30_LIMA = new Date("2026-12-01T04:59:00.000Z");
const BEFORE = new Date("2026-11-20T15:00:00.000Z");

test("el agente recibe el precio de hoy, el de antes, el porcentaje y la fecha ya hechos", () => {
  const p = { price: 40, currency: "USD", regularPrice: 50, saleEndsAt: END_NOV_30_LIMA };
  assert.deepEqual(agentPrice(p, "USD", LIMA, BEFORE), {
    price: 40,
    currency: "USD",
    priceInClientCurrency: true,
    regularPrice: 50,
    discount: "20 %",
    discountUntil: "30 de noviembre",
  });
  // Sin fecha de fin: sin «discountUntil».
  assert.deepEqual(agentPrice({ ...p, saleEndsAt: null }, null, LIMA, BEFORE), { price: 40, currency: "USD", regularPrice: 50, discount: "20 %" });
});

test("sin descuento o ya vencido, el agente no ve ningún descuento (y el vencido cuesta lo normal)", () => {
  assert.deepEqual(agentPrice({ price: 50, currency: "USD" }, "USD", LIMA, BEFORE), { price: 50, currency: "USD", priceInClientCurrency: true });
  const after = new Date("2026-12-01T05:00:00.000Z");
  assert.deepEqual(agentPrice({ price: 40, currency: "USD", regularPrice: 50, saleEndsAt: END_NOV_30_LIMA }, "USD", LIMA, after), {
    price: 50,
    currency: "USD",
    priceInClientCurrency: true,
  });
});

test("cliente de un país sin precio en su moneda: el precio base, marcado, con su descuento", () => {
  const p = { price: 40, currency: "USD", regularPrice: 50, saleEndsAt: null, prices: [{ currency: "PEN", amount: 150, regularAmount: 190 }] };
  assert.deepEqual(agentPrice(p, "MXN", LIMA, BEFORE), { price: 40, currency: "USD", priceInClientCurrency: false, regularPrice: 50, discount: "20 %" });
  assert.deepEqual(agentPrice(p, "PEN", LIMA, BEFORE), { price: 150, currency: "PEN", priceInClientCurrency: true, regularPrice: 190, discount: "21 %" });
});

test("la regla del agente sobre descuentos va con el catálogo; el seguimiento no menciona precios", () => {
  const build = (AgentService.prototype as unknown as {
    buildSystemParts(base: string, contact: object, tools: string[], split: boolean, extra: object): { system: string };
  }).buildSystemParts;
  const contact = { name: "Ana", phone: "+51987654321" };
  const withCatalog = build.call({}, "Eres Lia.", contact, ["search_products"], false, {}).system;
  assert.match(withCatalog, /Descuentos: si un producto trae «regularPrice», está rebajado/);
  assert.match(withCatalog, /No calcules otro precio ni otro porcentaje, no ofrezcas descuentos que no vengan en el producto y no alargues la fecha\./);
  const without = build.call({}, "Eres Lia.", contact, [], false, {}).system;
  assert.doesNotMatch(without, /Descuentos: si un producto trae/);
  // El seguimiento escribe desde el chat, donde puede haber una oferta que ya venció.
  assert.match(followUpDraftAsk("retomar la cotización"), /No menciones precios, descuentos ni fechas de oferta: pueden haber cambiado desde que se hablaron\./);
  assert.match(followUpDraftAsk("retomar la cotización"), /Objetivo del mensaje: retomar la cotización\./);
  assert.doesNotMatch(followUpDraftAsk("  "), /Objetivo del mensaje/);
});
