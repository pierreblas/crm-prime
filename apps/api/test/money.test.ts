/**
 * Precios multimoneda: país por prefijo, moneda del contacto y precio a usar.
 *
 *   npm run test:money --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  contactCurrency,
  countryFromPhone,
  priceColumnCurrency,
  priceFor,
  toProductImportRow,
  guessColumnMapping,
  productPricing,
  discountPercent,
  lenientDiscount,
  checkDiscount,
  discountUntilText,
} from "@crm/shared";

test("el país sale del prefijo más largo", () => {
  assert.equal(countryFromPhone("+5215512345678")?.code, "MX");
  assert.equal(countryFromPhone("+51987654321")?.currency, "PEN");
  assert.equal(countryFromPhone("+18095551234")?.code, "DO");
  assert.equal(countryFromPhone("+12125551234")?.code, "US");
  assert.equal(countryFromPhone("+593991234567")?.currency, "USD");
  assert.equal(countryFromPhone("+999123"), null);
});

test("la moneda fijada en la ficha gana a la del país", () => {
  assert.equal(contactCurrency({ phone: "+5215512345678" }), "MXN");
  assert.equal(contactCurrency({ phone: "+5215512345678", currency: "USD" }), "USD");
  assert.equal(contactCurrency({ phone: "+999123" }), null);
});

test("precio en la moneda del cliente, o el base marcado como respaldo", () => {
  const p = { price: 49, currency: "USD", prices: [{ currency: "MXN", amount: 899 }] };
  assert.deepEqual(priceFor(p, "MXN"), { amount: 899, currency: "MXN", fallback: false });
  assert.deepEqual(priceFor(p, "USD"), { amount: 49, currency: "USD", fallback: false });
  assert.deepEqual(priceFor(p, "PEN"), { amount: 49, currency: "USD", fallback: true });
  assert.deepEqual(priceFor(p, null), { amount: 49, currency: "USD", fallback: false });
});

test("la importación lee columnas precio_XXX", () => {
  assert.equal(priceColumnCurrency("precio_MXN"), "MXN");
  assert.equal(priceColumnCurrency("Precio (EUR)"), "EUR");
  assert.equal(priceColumnCurrency("precio"), null);
  const headers = ["nombre", "precio", "moneda", "precio_MXN", "precio_PEN"];
  const row = toProductImportRow(
    { nombre: "Plan Pro", precio: "49", moneda: "USD", precio_MXN: "899", precio_PEN: "" },
    guessColumnMapping(headers),
  );
  assert.ok(row.ok);
  if (row.ok) assert.deepEqual(row.value.prices, [{ currency: "MXN", amount: 899 }]);
});

// ── Descuentos de producto ──────────────────────────────────
const FUTURE = new Date(Date.now() + 5 * 86_400_000);
const PAST = new Date(Date.now() - 1_000);

test("descuento vigente: precio de hoy, precio de antes, porcentaje y hasta cuándo", () => {
  const p = { price: 40, currency: "USD", regularPrice: 50, saleEndsAt: FUTURE };
  assert.deepEqual(productPricing(p, "USD"), { amount: 40, currency: "USD", fallback: false, regular: 50, percent: 20, endsAt: FUTURE.toISOString() });
  // Sin fecha: vale mientras nadie lo quite.
  assert.deepEqual(productPricing({ ...p, saleEndsAt: null }, null), { amount: 40, currency: "USD", fallback: false, regular: 50, percent: 20, endsAt: null });
  // La fecha también puede venir como texto (de la API).
  assert.equal(productPricing({ ...p, saleEndsAt: FUTURE.toISOString() }, "USD").percent, 20);
});

test("descuento vencido: se lee el precio normal, sin esperar a que nadie lo corrija", () => {
  const p = { price: 40, currency: "USD", regularPrice: 50, saleEndsAt: PAST };
  assert.deepEqual(productPricing(p, "USD"), { amount: 50, currency: "USD", fallback: false, regular: null, percent: null, endsAt: null });
  assert.deepEqual(priceFor(p, "USD"), { amount: 50, currency: "USD", fallback: false });
  // Justo en el instante de fin ya venció.
  const now = new Date();
  assert.equal(productPricing({ ...p, saleEndsAt: now }, "USD", now).amount, 50);
});

test("cada moneda lleva su propio descuento; sin precio en la del cliente, el de la base", () => {
  const p = {
    price: 40,
    currency: "USD",
    regularPrice: 50,
    saleEndsAt: FUTURE,
    prices: [
      { currency: "PEN", amount: 150, regularAmount: 190 },
      { currency: "EUR", amount: 37 },
    ],
  };
  assert.deepEqual(productPricing(p, "PEN"), { amount: 150, currency: "PEN", fallback: false, regular: 190, percent: 21, endsAt: FUTURE.toISOString() });
  // EUR no tiene precio de antes: sin descuento en esa moneda aunque la base lo tenga.
  assert.deepEqual(productPricing(p, "EUR"), { amount: 37, currency: "EUR", fallback: false, regular: null, percent: null, endsAt: null });
  // Cliente de México, sin precio en MXN: el precio base, marcado como no convertido, con su descuento.
  assert.deepEqual(productPricing(p, "MXN"), { amount: 40, currency: "USD", fallback: true, regular: 50, percent: 20, endsAt: FUTURE.toISOString() });
  // Vencido: cada moneda vuelve a su normal; la que no tenía descuento no cambia.
  const expired = { ...p, saleEndsAt: PAST };
  assert.equal(productPricing(expired, "PEN").amount, 190);
  assert.equal(productPricing(expired, "EUR").amount, 37);
});

test("sin descuento de verdad no hay porcentaje: igual, menor, vacío o cero", () => {
  assert.equal(discountPercent(40, 50), 20);
  assert.equal(discountPercent(50, 50), null);
  assert.equal(discountPercent(50, 40), null);
  assert.equal(discountPercent(50, null), null);
  assert.equal(discountPercent(50, undefined), null);
  assert.equal(discountPercent(50, 0), null);
  assert.equal(discountPercent(49.9, 50), 1, "nunca «−0 %»");
  assert.equal(productPricing({ price: 50, currency: "USD", regularPrice: 50 }, "USD").regular, null);
});

test("lo que manda una tienda o un archivo: sin descuento válido, se guarda sin él", () => {
  assert.deepEqual(lenientDiscount(40, 50, FUTURE), { regularPrice: 50, saleEndsAt: FUTURE });
  assert.deepEqual(lenientDiscount(40, 50, null), { regularPrice: 50, saleEndsAt: null });
  assert.deepEqual(lenientDiscount(50, 50, FUTURE), { regularPrice: null, saleEndsAt: null });
  assert.deepEqual(lenientDiscount(50, 0, FUTURE), { regularPrice: null, saleEndsAt: null });
  assert.deepEqual(lenientDiscount(50, undefined, undefined), { regularPrice: null, saleEndsAt: null });
  assert.deepEqual(lenientDiscount(50, Number.NaN, FUTURE), { regularPrice: null, saleEndsAt: null });
});

test("lo que guarda una persona: se le dice qué está mal", () => {
  assert.equal(checkDiscount(40, 50, FUTURE.toISOString()), null);
  assert.equal(checkDiscount(40, 50, null), null);
  assert.equal(checkDiscount(50, null, null), null, "sin descuento");
  assert.equal(checkDiscount(50, 50, null), "El precio con descuento debe ser menor que el precio normal");
  assert.equal(checkDiscount(50, 40, null), "El precio con descuento debe ser menor que el precio normal");
  assert.equal(checkDiscount(50, null, FUTURE.toISOString()), "Pon el precio normal para usar una fecha de fin");
  assert.equal(checkDiscount(40, 50, PAST.toISOString()), "La fecha de fin del descuento ya pasó");
});

test("la fecha de fin se dice en la zona horaria de la empresa", () => {
  // Las 23:59 del 30 de noviembre en Lima ya son 1 de diciembre en UTC.
  assert.equal(discountUntilText("2026-12-01T04:59:00.000Z", "America/Lima"), "30 de noviembre");
  assert.equal(discountUntilText(new Date("2026-12-01T04:59:00.000Z"), "UTC"), "1 de diciembre");
});

test("importación: «precio oferta» pasa a ser el precio y el normal queda como el de antes", () => {
  const headers = ["Nombre", "Precio normal", "Precio oferta"];
  const mapping = guessColumnMapping(headers);
  assert.equal(mapping.price, "Precio normal");
  assert.equal(mapping.salePrice, "Precio oferta");
  const row = (oferta: string) => toProductImportRow({ Nombre: "Curso", "Precio normal": "50", "Precio oferta": oferta }, mapping);
  const on = row("40");
  assert.ok(on.ok);
  assert.deepEqual({ price: on.value.price, regularPrice: on.value.regularPrice }, { price: 40, regularPrice: 50 });
  // Vacía, igual o mayor: esa fila queda sin descuento.
  for (const oferta of ["", "50", "60"]) {
    const off = row(oferta);
    assert.ok(off.ok);
    assert.deepEqual({ price: off.value.price, regularPrice: off.value.regularPrice }, { price: 50, regularPrice: null }, `oferta «${oferta}»`);
  }
  const bad = row("abc");
  assert.ok(!bad.ok);
  assert.equal(bad.error, 'Precio con descuento no válido: "abc"');
  // Sin la columna, como siempre.
  const plain = toProductImportRow({ Nombre: "Curso", Precio: "50" }, guessColumnMapping(["Nombre", "Precio"]));
  assert.ok(plain.ok);
  assert.deepEqual({ price: plain.value.price, regularPrice: plain.value.regularPrice }, { price: 50, regularPrice: null });
  // «precio oferta» no es una columna de precio en otra moneda.
  assert.equal(priceColumnCurrency("Precio oferta"), null);
});
