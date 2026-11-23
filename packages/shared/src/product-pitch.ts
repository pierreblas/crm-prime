import { varKey } from "./contact-vars.js";

/**
 * El «speech» para presentar un producto (un curso, un servicio, un artículo)
 * cuando el cliente pregunta por él: una ficha corta para WhatsApp con los
 * datos del producto entre « », que el agente rellena con lo que devuelve
 * search_products. Lo usan el editor del agente (botón «Insertar speech») y el
 * asistente que redacta las instrucciones, para que propongan lo mismo.
 *
 * No lleva ningún valor del catálogo: precios y fechas cambian, y el agente los
 * consulta en cada conversación. Un dato que el producto no tenga se quita.
 */

/**
 * Los datos del descuento de un producto rebajado: el nombre con el que se
 * ponen en las instrucciones (entre « ») y el campo con el que le llegan al
 * agente desde search_products. Solo vienen si el descuento está vigente.
 */
export const PRODUCT_DISCOUNT_DATA = [
  { label: "Precio normal", field: "regularPrice", hint: "El precio de antes. Solo si el producto está rebajado." },
  { label: "Descuento", field: "discount", hint: "El porcentaje de descuento, como «20 %». Solo si está rebajado." },
  { label: "Descuento hasta", field: "discountUntil", hint: "Hasta qué día vale el descuento, si tiene fecha de fin." },
] as const;

/** Los datos que trae todo producto; los campos propios van detrás. */
const BASE = ["Nombre", "Precio", ...PRODUCT_DISCOUNT_DATA.map((d) => d.label), "Descripción", "SKU"];

export function productPitchTemplate(fields: string[], opts: { photo?: boolean; files?: string[] } = {}): string {
  const base = new Set(BASE.map(varKey));
  const own = [...new Map(fields.filter((f) => f.trim() && !base.has(varKey(f))).map((f) => [varKey(f), f.trim()])).values()];
  return [
    "PRESENTACIÓN DE UN PRODUCTO",
    "Cuando pregunten por un producto, búscalo con search_products y preséntalo así, con sus datos tal cual. Si al producto le falta un dato, quita esa línea: nunca lo inventes ni digas que falta.",
    "",
    "*«Nombre»*",
    "«Descripción» (en una sola línea)",
    "💰 «Precio»",
    "🏷️ Antes ~«Precio normal»~ · «Descuento» de descuento, hasta «Descuento hasta» (solo si está rebajado; si no, quita esta línea)",
    ...own.map((f) => `• ${f}: «${f}»`),
    "",
    ...(opts.photo ? ["Si tiene foto, envíala con send_product_image."] : []),
    ...(opts.files?.length ? [`Si pide ${opts.files.join(" o ")}, envíale el archivo con send_product_file.`] : []),
    'Cierra con una sola pregunta para avanzar, por ejemplo: "¿Te lo reservo?" o "¿Te comparto los datos de pago?".',
    "Si ya lo presentaste en esta conversación, no lo repitas: responde solo lo que pregunte.",
  ].join("\n");
}
