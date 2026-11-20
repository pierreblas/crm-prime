/**
 * Monedas y países para precios multimoneda.
 *
 * El país de un contacto se deduce del prefijo internacional de su teléfono
 * (E.164), y de ahí su moneda. No hace falta guardarlo: se calcula al leer,
 * así funciona para todos los contactos ya existentes y para cualquier vía de
 * alta. La moneda sí se puede fijar a mano en la ficha (p. ej. un cliente de
 * Ecuador al que se le cobra en PEN).
 *
 * No hay conversión automática por tipo de cambio: cada producto lleva sus
 * precios explícitos por moneda, porque el precio real en otro país suele ser
 * un número redondo decidido por el negocio, no USD × cambio del día.
 */
import { isSocialId, isWaUserId } from "./phone.js";

export interface CurrencyInfo {
  code: string;
  label: string;
}

/** Monedas que se ofrecen en los selectores (orden: las más usadas primero). */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", label: "Dólar estadounidense" },
  { code: "EUR", label: "Euro" },
  { code: "MXN", label: "Peso mexicano" },
  { code: "PEN", label: "Sol peruano" },
  { code: "COP", label: "Peso colombiano" },
  { code: "CLP", label: "Peso chileno" },
  { code: "ARS", label: "Peso argentino" },
  { code: "BRL", label: "Real brasileño" },
  { code: "BOB", label: "Boliviano" },
  { code: "PYG", label: "Guaraní paraguayo" },
  { code: "UYU", label: "Peso uruguayo" },
  { code: "VES", label: "Bolívar venezolano" },
  { code: "GTQ", label: "Quetzal guatemalteco" },
  { code: "HNL", label: "Lempira hondureño" },
  { code: "NIO", label: "Córdoba nicaragüense" },
  { code: "CRC", label: "Colón costarricense" },
  { code: "DOP", label: "Peso dominicano" },
  { code: "CAD", label: "Dólar canadiense" },
  { code: "GBP", label: "Libra esterlina" },
];

export interface CountryInfo {
  code: string; // ISO 3166-1 alfa-2
  name: string;
  currency: string; // ISO 4217
}

/**
 * Prefijos internacionales → país. Se busca el prefijo más largo que
 * coincida, así "+1809" (República Dominicana) gana a "+1" (EE. UU.).
 */
const PREFIXES: Array<[string, CountryInfo]> = [
  ["1809", { code: "DO", name: "República Dominicana", currency: "DOP" }],
  ["1829", { code: "DO", name: "República Dominicana", currency: "DOP" }],
  ["1849", { code: "DO", name: "República Dominicana", currency: "DOP" }],
  ["1787", { code: "PR", name: "Puerto Rico", currency: "USD" }],
  ["1939", { code: "PR", name: "Puerto Rico", currency: "USD" }],
  ["1", { code: "US", name: "Estados Unidos o Canadá", currency: "USD" }],
  ["34", { code: "ES", name: "España", currency: "EUR" }],
  ["44", { code: "GB", name: "Reino Unido", currency: "GBP" }],
  ["33", { code: "FR", name: "Francia", currency: "EUR" }],
  ["39", { code: "IT", name: "Italia", currency: "EUR" }],
  ["49", { code: "DE", name: "Alemania", currency: "EUR" }],
  ["351", { code: "PT", name: "Portugal", currency: "EUR" }],
  ["52", { code: "MX", name: "México", currency: "MXN" }],
  ["51", { code: "PE", name: "Perú", currency: "PEN" }],
  ["57", { code: "CO", name: "Colombia", currency: "COP" }],
  ["56", { code: "CL", name: "Chile", currency: "CLP" }],
  ["54", { code: "AR", name: "Argentina", currency: "ARS" }],
  ["55", { code: "BR", name: "Brasil", currency: "BRL" }],
  ["591", { code: "BO", name: "Bolivia", currency: "BOB" }],
  ["593", { code: "EC", name: "Ecuador", currency: "USD" }],
  ["595", { code: "PY", name: "Paraguay", currency: "PYG" }],
  ["598", { code: "UY", name: "Uruguay", currency: "UYU" }],
  ["58", { code: "VE", name: "Venezuela", currency: "VES" }],
  ["502", { code: "GT", name: "Guatemala", currency: "GTQ" }],
  ["503", { code: "SV", name: "El Salvador", currency: "USD" }],
  ["504", { code: "HN", name: "Honduras", currency: "HNL" }],
  ["505", { code: "NI", name: "Nicaragua", currency: "NIO" }],
  ["506", { code: "CR", name: "Costa Rica", currency: "CRC" }],
  ["507", { code: "PA", name: "Panamá", currency: "USD" }],
];

/** País de un teléfono en formato internacional, o null si no se reconoce. */
/** Países que Driony reconoce por el prefijo telefónico, sin repetir y por nombre. */
export const COUNTRIES: CountryInfo[] = Array.from(
  new Map(PREFIXES.map(([, info]) => [info.code, info])).values(),
).sort((a, b) => a.name.localeCompare(b.name, "es"));

/** Prefijo internacional de un país (sin «+»): «51» para PE. */
export function dialCodeOf(code: string): string | null {
  let best: string | null = null;
  for (const [prefix, info] of PREFIXES) if (info.code === code && (!best || prefix.length < best.length)) best = prefix;
  return best;
}

export function countryFromPhone(phone: string | null | undefined): CountryInfo | null {
  // Cliente de Messenger o Instagram: no se sabe de qué país es.
  if (isSocialId(phone)) return null;
  // Usuario de WhatsApp sin número: su identificador empieza por el país («PE.…»).
  if (isWaUserId(phone)) return COUNTRIES.find((c) => c.code === phone!.slice(0, 2)) ?? null;
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let best: CountryInfo | null = null;
  let bestLen = 0;
  for (const [prefix, info] of PREFIXES) {
    if (prefix.length > bestLen && digits.startsWith(prefix)) {
      best = info;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * Moneda con la que se le habla de precios a un contacto: la fijada a mano en
 * su ficha; si no, la de su país; si no se reconoce el país, null.
 */
export function contactCurrency(contact: {
  phone: string;
  currency?: string | null;
}): string | null {
  return contact.currency ?? countryFromPhone(contact.phone)?.currency ?? null;
}

export interface PriceEntry {
  currency: string;
  amount: number;
  /** Precio normal en esa moneda si está rebajada; null o ausente = sin descuento. */
  regularAmount?: number | null;
}

/** Un producto con lo que hace falta para saber qué precio rige. */
export interface PricedProduct {
  /** Lo que se paga hoy en la moneda base. */
  price: number;
  currency: string;
  /** Precio normal si está rebajado; null o ausente = sin descuento. */
  regularPrice?: number | null;
  /** Hasta cuándo vale el descuento (una fecha para todas sus monedas); null = sin fecha. */
  saleEndsAt?: Date | string | null;
  prices?: PriceEntry[];
}

export interface ProductPricing {
  amount: number;
  currency: string;
  /** El producto no tiene precio en la moneda pedida: es el de la base. */
  fallback: boolean;
  /** Precio de antes, solo con descuento vigente. */
  regular: number | null;
  /** Porcentaje de descuento, entero; solo con descuento vigente. */
  percent: number | null;
  /** Hasta cuándo vale (ISO), si el descuento vigente tiene fecha. */
  endsAt: string | null;
}

const validRegular = (amount: number, regular: number | null | undefined): regular is number =>
  typeof regular === "number" && Number.isFinite(regular) && regular > amount;

/**
 * Porcentaje de descuento, entero y nunca 0 (un «−0 %» no dice nada); null si
 * no hay descuento: el precio de antes falta, es cero o no es mayor.
 */
export function discountPercent(amount: number, regular: number | null | undefined): number | null {
  if (!validRegular(amount, regular)) return null;
  return Math.max(1, Math.round((1 - amount / regular) * 100));
}

/**
 * Qué precio rige ahora para esa moneda y, si está rebajado, el de antes, el
 * porcentaje y hasta cuándo. Un descuento vencido se lee como precio normal
 * aunque la fila siga rebajada (el barrido la corrige después): ofrecer una
 * oferta que ya terminó es justo lo que no puede pasar.
 */
export function productPricing(product: PricedProduct, currency: string | null, now: Date = new Date()): ProductPricing {
  const hit = currency && currency !== product.currency ? product.prices?.find((p) => p.currency === currency) : undefined;
  const base = !currency || currency === product.currency;
  const entry = hit
    ? { amount: hit.amount, currency: hit.currency, regular: hit.regularAmount, fallback: false }
    : { amount: product.price, currency: product.currency, regular: product.regularPrice, fallback: !base };
  const ends = product.saleEndsAt ? new Date(product.saleEndsAt) : null;
  const none = { regular: null, percent: null, endsAt: null };
  if (!validRegular(entry.amount, entry.regular)) {
    return { amount: entry.amount, currency: entry.currency, fallback: entry.fallback, ...none };
  }
  if (ends && ends.getTime() <= now.getTime()) {
    return { amount: entry.regular, currency: entry.currency, fallback: entry.fallback, ...none };
  }
  return {
    amount: entry.amount,
    currency: entry.currency,
    fallback: entry.fallback,
    regular: entry.regular,
    percent: discountPercent(entry.amount, entry.regular),
    endsAt: ends ? ends.toISOString() : null,
  };
}

/**
 * Lo que entra de una tienda o de un archivo: si no trae un descuento de
 * verdad (precio de antes mayor que el de hoy), se guarda sin descuento y sin
 * fecha. Una tienda que manda los dos precios iguales no tiene oferta.
 */
export function lenientDiscount(
  price: number,
  regular: number | null | undefined,
  endsAt: Date | null | undefined,
): { regularPrice: number | null; saleEndsAt: Date | null } {
  if (!validRegular(price, regular)) return { regularPrice: null, saleEndsAt: null };
  return { regularPrice: regular, saleEndsAt: endsAt ?? null };
}

/**
 * Lo que guarda una persona (o la API): el mensaje de lo que está mal, o null
 * si vale. Sin precio normal ni fecha no hay descuento, y eso vale.
 */
export function checkDiscount(
  price: number,
  regularPrice: number | null | undefined,
  saleEndsAt: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  if (regularPrice == null) return saleEndsAt ? "Pon el precio normal para usar una fecha de fin" : null;
  if (!validRegular(price, regularPrice)) return "El precio con descuento debe ser menor que el precio normal";
  if (saleEndsAt && new Date(saleEndsAt).getTime() <= now.getTime()) return "La fecha de fin del descuento ya pasó";
  return null;
}

/** «30 de noviembre»: el día en que acaba el descuento, en esa zona horaria. */
export function discountUntilText(endsAt: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone }).format(new Date(endsAt));
}

/**
 * Precio de un producto en la moneda pedida. Si el producto no tiene precio
 * en esa moneda, se devuelve el precio base con `fallback: true` para que
 * quien lo muestre (el agente, la ficha) no lo presente como si lo tuviera.
 */
export function priceFor(
  product: PricedProduct,
  currency: string | null,
  now: Date = new Date(),
): { amount: number; currency: string; fallback: boolean } {
  const { amount, currency: cur, fallback } = productPricing(product, currency, now);
  return { amount, currency: cur, fallback };
}

/** "S/ 1,490.00", "$1,490.00 MXN"… con el formato del idioma dado. */
export function formatMoney(amount: number, currency: string, locale = "es"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
