import { formatFieldValue, readProductFile } from "@crm/shared";

export interface DetailField {
  key: string;
  label: string;
  type: string;
  unit: string | null;
}

/**
 * Los campos de un producto tal como los lee el agente: los datos con su nombre,
 * qué archivos tiene (solo el nombre del campo: ni la dirección ni la referencia,
 * para que no pueda pegarlas ni inventarlas) y los campos que le faltan. Estos
 * últimos se dicen porque, si no, una plantilla con «Temario» o [Con certificado
 * UNALM] invitaba al modelo a rellenarlos.
 */
export function productDetails(attributes: unknown, fields: DetailField[]): { details?: Record<string, string>; files?: string[]; missingDetails?: string[] } {
  const attrs = attributes && typeof attributes === "object" ? (attributes as Record<string, unknown>) : {};
  const details: Record<string, string> = {};
  const files: string[] = [];
  const missing: string[] = [];
  for (const f of fields) {
    const v = attrs[f.key];
    if (typeof v !== "string" || !v) missing.push(f.label);
    else if (f.type !== "file") details[f.label] = formatFieldValue(f, v);
    else if (readProductFile(v)) files.push(f.label);
    else missing.push(f.label);
  }
  return {
    ...(Object.keys(details).length ? { details } : {}),
    ...(files.length ? { files } : {}),
    ...(missing.length ? { missingDetails: missing } : {}),
  };
}

/**
 * Los archivos que NO tienen los productos encontrados, dichos con lo que hay que
 * hacer: solo con la lista de datos que faltan, gpt-5-mini ofrecía «¿te paso el
 * brochure?» de un curso que no lo tenía. Vacío si no falta ninguno.
 */
export function missingFilesNote(products: { name: string; missing: string[] }[], fileLabels: string[]): string {
  const gone = products.flatMap((p) => p.missing.filter((l) => fileLabels.includes(l)).map((l) => `«${l}» de ${p.name}`));
  if (!gone.length) return "";
  return ` No hay archivo para ${gone.join(", ")}: no lo ofrezcas ni prometas mandarlo; si lo pide, dile con naturalidad que de ese no lo tienes a mano y sigue ayudándole.`;
}
