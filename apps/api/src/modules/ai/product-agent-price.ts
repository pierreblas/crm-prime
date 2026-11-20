import { discountUntilText, productPricing, type PricedProduct } from "@crm/shared";

/** La zona horaria con la que se dice una fecha si la empresa no tiene agenda configurada. */
export const DEFAULT_DISCOUNT_TIME_ZONE = "America/Lima";

/**
 * El precio de un producto como lo recibe el agente en search_products: lo que
 * se paga hoy en la moneda del cliente (o el precio base, marcado, si el
 * producto no la tiene) y, solo con un descuento vigente, el precio de antes,
 * el porcentaje y hasta cuándo vale, ya hechos. El agente no calcula: un
 * modelo que hace cuentas con precios se equivoca, y un descuento vencido no
 * se ofrece (aquí ya sale como precio normal, sin nada de descuento).
 */
export function agentPrice(
  product: PricedProduct,
  clientCurrency: string | null,
  timeZone: string,
  now: Date = new Date(),
): { price: number; currency: string; priceInClientCurrency?: boolean; regularPrice?: number; discount?: string; discountUntil?: string } {
  const p = productPricing(product, clientCurrency, now);
  return {
    price: p.amount,
    currency: p.currency,
    ...(clientCurrency ? { priceInClientCurrency: !p.fallback } : {}),
    ...(p.regular !== null
      ? {
          regularPrice: p.regular,
          discount: `${p.percent} %`,
          ...(p.endsAt ? { discountUntil: discountUntilText(p.endsAt, timeZone) } : {}),
        }
      : {}),
  };
}
