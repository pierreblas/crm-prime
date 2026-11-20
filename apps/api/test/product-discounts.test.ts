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
