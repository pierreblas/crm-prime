/**
 * Normalización de teléfonos a E.164 (`+` seguido de 7-15 dígitos).
 *
 * Existe porque los números llegan por vías con formatos distintos y, sin
 * unificarlos, el MISMO cliente se duplica: la Cloud API de Meta manda el
 * `wa_id` sin `+` (`5215512345678`), mientras que el alta manual y los
 * webhooks de leads suelen traerlo con `+`, con espacios o con guiones.
 * Como `Contact.phone` es único, ambos formatos crean dos contactos.
 *
 * Ojo: esto arregla el FORMATO, no el prefijo de país. Un número nacional
 * suelto ("5512345678") no se puede completar sin saber el país, así que se
 * queda como "+5512345678"; `isValidPhone` solo comprueba la forma.
 */

export function normalizePhone(raw: string): string {
  // "00" inicial es la marcación internacional: equivale al "+".
  const trimmed = raw.trim().replace(/^00/, "+");
  const digits = trimmed.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

// E.164: "+", un primer dígito no nulo y entre 7 y 15 dígitos en total.
const E164 = /^\+[1-9]\d{6,14}$/;

export function isValidPhone(value: string): boolean {
  return E164.test(value);
}

/**
 * Normaliza un número que puede venir sin prefijo de país (un formulario de
 * Meta, una importación): si no trae «+» ni «00» y es corto (hasta 10
 * dígitos, el tamaño de un número nacional), se le pone el prefijo indicado
 * («51» para Perú). Un número largo se toma como que ya lo trae.
 */
export function phoneWithDefaultCountry(raw: string, dialCode: string | null): string {
  const trimmed = raw.trim();
  if (!dialCode || /^(\+|00)/.test(trimmed)) return normalizePhone(trimmed);
  const digits = trimmed.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  return digits.length <= 10 ? `+${dialCode}${digits}` : `+${digits}`;
}

/**
 * Las formas en que puede estar guardado el mismo móvil, la propia incluida.
 *
 * WhatsApp identifica los móviles de México con «521» y los de Argentina con
 * «549», mientras que un formulario de Meta, una importación o un alta manual
 * suelen traerlos sin ese dígito («52…», «54…»). Sin esto, el lead del
 * formulario y su chat de WhatsApp quedan como dos contactos distintos.
 */
export function phoneVariants(e164: string): string[] {
  const d = e164.replace(/\D/g, "");
  if (!d) return [];
  const out = new Set([`+${d}`]);
  if (/^521\d{10}$/.test(d)) out.add(`+52${d.slice(3)}`);
  else if (/^52\d{10}$/.test(d)) out.add(`+521${d.slice(2)}`);
  if (/^549\d{10}$/.test(d)) out.add(`+54${d.slice(3)}`);
  else if (/^54\d{10}$/.test(d)) out.add(`+549${d.slice(2)}`);
  return [...out];
}

/**
 * Clave comparable de un número (solo dígitos), para detectar que dos
 * contactos escritos distinto son en realidad el mismo.
 */
export function phoneKey(raw: string): string {
  return raw.replace(/\D/g, "");
}
