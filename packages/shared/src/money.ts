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

export function countryFromPhone(phone: string | null | undefined): CountryInfo | null {
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
}

/**
 * Precio de un producto en la moneda pedida. Si el producto no tiene precio
 * en esa moneda, se devuelve el precio base con `fallback: true` para que
 * quien lo muestre (el agente, la ficha) no lo presente como si lo tuviera.
 */
export function priceFor(
  product: { price: number; currency: string; prices?: PriceEntry[] },
  currency: string | null,
): { amount: number; currency: string; fallback: boolean } {
  if (!currency || currency === product.currency) {
    return { amount: product.price, currency: product.currency, fallback: false };
  }
  const hit = product.prices?.find((p) => p.currency === currency);
  if (hit) return { amount: hit.amount, currency: hit.currency, fallback: false };
  return { amount: product.price, currency: product.currency, fallback: true };
}

/** "S/ 1,490.00", "$1,490.00 MXN"… con el formato del idioma dado. */
export function formatMoney(amount: number, currency: string, locale = "es"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
