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

/** Los datos que trae todo producto; los campos propios van detrás. */
const BASE = ["Nombre", "Precio", "Descripción", "SKU"];

export function productPitchTemplate(fields: string[], opts: { photo?: boolean } = {}): string {
  const base = new Set(BASE.map(varKey));
  const own = [...new Map(fields.filter((f) => f.trim() && !base.has(varKey(f))).map((f) => [varKey(f), f.trim()])).values()];
  return [
    "PRESENTACIÓN DE UN PRODUCTO",
    "Cuando pregunten por un producto, búscalo con search_products y preséntalo así, con sus datos tal cual. Si al producto le falta un dato, quita esa línea: nunca lo inventes.",
    "",
    "*«Nombre»*",
    "«Descripción» (en una sola línea)",
    "💰 «Precio»",
    ...own.map((f) => `• ${f}: «${f}»`),
    "",
    ...(opts.photo ? ["Si tiene foto, envíala con send_product_image."] : []),
    'Cierra con una sola pregunta para avanzar, por ejemplo: "¿Te lo reservo?" o "¿Te comparto los datos de pago?".',
    "Si ya lo presentaste en esta conversación, no lo repitas: responde solo lo que pregunte.",
  ].join("\n");
}
