import { z } from "zod";
import { utmKeys } from "./attribution.js";
import { fieldKeyFromLabel } from "./schemas/contact-import.schema.js";

/**
 * Campos del lead. Un contacto es la persona (nombre, teléfono, correo); un lead
 * es un interés concreto suyo, la oportunidad del embudo. Lo que alguien
 * responde en un formulario y la campaña por la que llegó son de ese interés:
 * si mañana pregunta por otro curso, no deben pisar lo de hoy.
 */

/** Un campo definido en Ajustes, con dónde vive. */
export interface LeadFieldDef {
  key: string;
  label: string;
  /** "contact" (por defecto) o "deal" (del lead). */
  entity?: string | null;
}

/** Datos de origen que pone Driony en el contacto: tienen su sitio, no son campos por definir. */
export const ORIGIN_FIELD_KEYS: readonly string[] = ["formulario", "campana", "anuncio"];

/** Cómo llegó un lead: se guarda con él, tal como era ese día. */
export const leadOriginSchema = z.object({
  form: z.string().nullable().default(null),
  formId: z.string().nullable().default(null),
  campaign: z.string().nullable().default(null),
  ad: z.string().nullable().default(null),
  /** fb | ig */
  platform: z.string().nullable().default(null),
  utm: z.record(z.string()).default({}),
  /** Cuándo llegó (ISO). */
  at: z.string().nullable().default(null),
});
export type LeadOrigin = z.infer<typeof leadOriginSchema>;

/** Lee el origen guardado (JSON libre). Null si no hay nada que mostrar. */
export function parseLeadOrigin(raw: unknown): LeadOrigin | null {
  const p = leadOriginSchema.safeParse(raw);
  if (!p.success) return null;
  const o = p.data;
  return o.form || o.campaign || o.ad || Object.keys(o.utm).length ? o : null;
}

export interface SplitLeadInput {
  /** Lo que el formulario manda, por regla, a un campo del contacto. */
  contact?: Record<string, string>;
  /** Lo que manda, por regla, a un campo del lead. */
  lead?: Record<string, string>;
  /** Preguntas sin asignar, con el nombre con que llegan. */
  answers?: Record<string, string>;
  defs: ReadonlyArray<LeadFieldDef>;
  /** ¿Hay una oportunidad donde guardarlas? Sin ella, todo se queda en el contacto. */
  hasLead: boolean;
}

/**
 * Reparte lo que trae un lead entre la persona y su oportunidad:
 *  - lo asignado a mano va a donde se asignó;
 *  - una respuesta que coincide con un campo definido (por clave o por nombre)
 *    va a donde vive ese campo;
 *  - el resto de respuestas son del lead;
 *  - los utm_* van aparte: son la campaña, no un dato.
 */
export function splitLeadData(input: SplitLeadInput): {
  contact: Record<string, string>;
  lead: Record<string, string>;
  utms: Record<string, string>;
} {
  const contact: Record<string, string> = {};
  const lead: Record<string, string> = {};
  const utms: Record<string, string> = {};
  const byKey = new Map<string, LeadFieldDef>(input.defs.map((d) => [d.key, d]));
  for (const d of input.defs) {
    const fromLabel = fieldKeyFromLabel(d.label);
    if (!byKey.has(fromLabel)) byKey.set(fromLabel, d);
  }
  const put = (to: Record<string, string>, key: string, value: string) => {
    const v = String(value ?? "").trim();
    if (v) to[key] = v;
  };
  for (const [k, v] of Object.entries(input.contact ?? {})) put(contact, k, v);
  for (const [k, v] of Object.entries(input.lead ?? {})) put(input.hasLead ? lead : contact, k, v);
  for (const [raw, v] of Object.entries(input.answers ?? {})) {
    const slug = byKey.has(raw) ? raw : fieldKeyFromLabel(raw);
    if ((utmKeys as readonly string[]).includes(slug)) {
      put(utms, slug, v);
      continue;
    }
    const def = byKey.get(slug);
    const toLead = def ? def.entity === "deal" : true;
    put(toLead && input.hasLead ? lead : contact, def?.key ?? slug, v);
  }
  return { contact, lead, utms };
}

/** Los campos guardados de un lead (JSON libre) como texto por clave. */
export function leadFieldsOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v != null && String(v).trim() !== "") out[k] = String(v);
    }
  }
  return out;
}

/** Llega otro formulario al mismo lead: lo nuevo manda, lo demás se conserva. */
export function mergeLeadFields(current: unknown, incoming: Record<string, string>): Record<string, string> {
  return { ...leadFieldsOf(current), ...leadFieldsOf(incoming) };
}

/** «cual_es_tu_objetivo» → «Cual es tu objetivo», para mostrar un dato sin campo definido. */
export function humanizeFieldKey(key: string): string {
  const s = key.replace(/_+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : key;
}

/** Lo que el agente lee de un lead: «Nombre del campo: valor; …». Vacío si no hay nada. */
export function leadFieldsText(raw: unknown, defs: ReadonlyArray<LeadFieldDef>): string {
  const labels = new Map(defs.map((d) => [d.key, d.label]));
  return Object.entries(leadFieldsOf(raw))
    .map(([k, v]) => `${labels.get(k) ?? humanizeFieldKey(k)}: ${v}`)
    .join("; ");
}
