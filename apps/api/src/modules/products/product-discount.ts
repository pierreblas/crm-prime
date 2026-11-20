import { BadRequestException } from "@nestjs/common";
import { checkDiscount, lenientDiscount, productPricing, type PricedProduct } from "@crm/shared";

/**
 * Descuentos de producto en el servidor: qué se guarda cuando alguien crea o
 * edita un producto, y cómo sale un producto guardado (con el vencimiento ya
 * aplicado). El cálculo vive en @crm/shared (productPricing).
 *
 * `price` es siempre lo que se paga hoy; `regularPrice`, el precio de antes.
 */

type Decimalish = number | { toString(): string } | null | undefined;
const num = (v: Decimalish): number | null => (v == null ? null : Number(v));

export interface StoredDiscount {
  price: Decimalish;
  regularPrice?: Decimalish;
  saleEndsAt?: Date | null;
}

/**
 * El descuento que queda guardado tras crear (`existing` null) o editar.
 *
 * - Quien manda `regularPrice` o `saleEndsAt` está hablando de descuentos: se
 *   comprueba y, si no es un descuento de verdad, se rechaza con el motivo.
 *   `regularPrice: null` lo quita, con su fecha.
 * - Quien no los manda (cambia el nombre, o un ERP que solo empuja el precio)
 *   no rompe nada: el descuento sigue si el precio nuevo queda por debajo del
 *   normal, y desaparece sin error si lo iguala o lo supera.
 */
export function resolveDiscount(
  body: { price?: number; regularPrice?: number | null; saleEndsAt?: string | null },
  existing: StoredDiscount | null,
): { regularPrice: number | null; saleEndsAt: Date | null } {
  const price = body.price ?? num(existing?.price) ?? 0;
  const savedRegular = num(existing?.regularPrice);
  const savedEnds = existing?.saleEndsAt ?? null;
  if (body.regularPrice === undefined && body.saleEndsAt === undefined) {
    return lenientDiscount(price, savedRegular, savedEnds);
  }
  const regular = body.regularPrice !== undefined ? body.regularPrice : savedRegular;
  // La fecha solo se exige futura cuando es la que llega ahora: una ya guardada
  // y vencida la corrige el barrido, no bloquea al que edita otra cosa.
  const error = checkDiscount(price, regular, body.saleEndsAt ?? null);
  if (error) throw new BadRequestException(error);
  if (regular == null) return { regularPrice: null, saleEndsAt: null };
  const ends = body.saleEndsAt !== undefined ? (body.saleEndsAt ? new Date(body.saleEndsAt) : null) : savedEnds;
  return { regularPrice: regular, saleEndsAt: ends };
}

/** Cada otra moneda con precio de antes tiene que ser un descuento de verdad. */
export function assertPriceDiscounts(prices: { currency: string; amount: number; regularAmount?: number | null }[]): void {
  for (const p of prices) {
    if (p.regularAmount == null) continue;
    const error = checkDiscount(p.amount, p.regularAmount, null);
    if (error) throw new BadRequestException(`${error} (${p.currency})`);
  }
}

/**
 * El precio de un producto guardado como lo devuelve la API: lo de hoy, lo de
 * antes, el porcentaje y la fecha, en la base y en cada moneda. Un descuento
 * vencido sale ya como precio normal, sin esperar al barrido.
 */
export function pricedDto(
  p: { price: Decimalish; currency: string; regularPrice?: Decimalish; saleEndsAt?: Date | null; prices: { currency: string; amount: Decimalish; regularAmount?: Decimalish }[] },
  now: Date = new Date(),
): {
  price: number;
  regularPrice: number | null;
  saleEndsAt: string | null;
  discountPercent: number | null;
  prices: { currency: string; amount: number; regularAmount: number | null }[];
} {
  const product: PricedProduct = {
    price: Number(p.price),
    currency: p.currency,
    regularPrice: num(p.regularPrice),
    saleEndsAt: p.saleEndsAt ?? null,
    prices: p.prices.map((x) => ({ currency: x.currency, amount: Number(x.amount), regularAmount: num(x.regularAmount) })),
  };
  const base = productPricing(product, null, now);
  const prices = product.prices!.map((x) => {
    const r = productPricing(product, x.currency, now);
    return { currency: x.currency, amount: r.amount, regularAmount: r.regular };
  });
  // Una fecha para todas las monedas: se enseña si alguna sigue rebajada.
  const ends = base.endsAt ?? product.prices!.map((x) => productPricing(product, x.currency, now).endsAt).find(Boolean) ?? null;
  return { price: base.amount, regularPrice: base.regular, saleEndsAt: ends, discountPercent: base.percent, prices };
}
