import { includedAiCapUsd, PLANS, PLAN_KEYS, type PlatformAuditEntry, type PlatformOrg } from "@crm/shared";

export const money = (n: number) => `USD ${n.toFixed(2)}`;
export const date = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function relative(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 60) return `hace ${days} d`;
  return date(iso);
}

/** La prueba del alta mientras corre («prueba · 12 d»); terminada no se marca. */
export function trialTag(org: Pick<PlatformOrg, "inTrial" | "trialEndsAt">): { kind: "active" | "ending" | "none"; label: string } {
  if (!org.trialEndsAt) return { kind: "none", label: "" };
  const days = Math.ceil((new Date(org.trialEndsAt).getTime() - Date.now()) / 86_400_000);
  if (org.inTrial) return { kind: days <= 3 ? "ending" : "active", label: days <= 1 ? "prueba · último día" : `prueba · ${days} d` };
  return { kind: "none", label: "" };
}

/** Estado del vencimiento del plan: vencido, a punto, lejos, o sin fecha. */
export function expiry(org: Pick<PlatformOrg, "planExpiresAt">): { kind: "none" | "expired" | "soon" | "ok"; label: string; days: number } {
  if (!org.planExpiresAt) return { kind: "none", label: "—", days: Infinity };
  const days = Math.ceil((new Date(org.planExpiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { kind: "expired", label: `venció ${date(org.planExpiresAt)}`, days };
  if (days <= 7) return { kind: "soon", label: days === 0 ? "vence hoy" : `en ${days} d`, days };
  return { kind: "ok", label: date(org.planExpiresAt), days };
}

/** La fecha ISO como valor de un <input type="date"> (en local). */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Un día elegido en el input → fin de ese día, en ISO. */
export function fromDateInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const PLAN_NAMES: Record<string, string> = Object.fromEntries(PLAN_KEYS.map((k) => [k, PLANS[k].name]));

/** Tope en dólares de la IA incluida de una empresa: su cupo más sus conversaciones extra del mes y las que le quedan. */
export function orgAiCapUsd(o: Pick<PlatformOrg, "aiIncludedLimit" | "aiExtraRemaining" | "aiExtraUsedMonth">): number {
  return includedAiCapUsd((o.aiIncludedLimit ?? 0) + o.aiExtraUsedMonth + o.aiExtraRemaining);
}

/** Una línea del diario, en palabras. */
export function describeAudit(e: PlatformAuditEntry): string {
  const d = e.details ?? {};
  switch (e.action) {
    case "plan_changed":
      return `Cambió el plan de ${PLAN_NAMES[String(d.from)] ?? d.from} a ${PLAN_NAMES[String(d.to)] ?? d.to}`;
    case "suspended":
      return "Suspendió la empresa";
    case "reactivated":
      return "Reactivó la empresa";
    case "expiry_changed":
      return d.to ? `Puso el vencimiento el ${date(String(d.to))}` : "Quitó el vencimiento";
    case "trial_changed":
      return d.to ? `Puso la prueba hasta el ${date(String(d.to))}` : "Quitó la prueba";
    case "notes_changed":
      return "Editó las notas internas";
    case "login_as":
      return `Entró al panel como ${d.email ?? "administrador"}`;
    case "ai_pack_added":
      return `Añadió ${Number(d.conversations ?? 0).toLocaleString("es")} conversaciones extra${d.priceUsd === null || d.priceUsd === undefined ? " (regalo)" : ` (USD ${d.priceUsd})`}`;
    case "ai_pack_removed":
      return `Quitó un paquete de ${Number(d.conversations ?? 0).toLocaleString("es")} conversaciones extra (${Number(d.used ?? 0).toLocaleString("es")} gastadas)`;
    // Cotizador de implementaciones.
    case "assessment_created":
      return `Creó el diagnóstico «${d.title ?? ""}» para ${d.clientName ?? "un cliente"}`;
    case "quote_created":
      return `Abrió la cotización ${quoteRef(d)}`;
    case "quote_submitted":
      return `Envió a revisión ${quoteRef(d)}${d.belowMinimum ? " (por debajo del mínimo)" : ""}`;
    case "quote_reopened":
      return `Devolvió a borrador ${quoteRef(d)}${d.reason ? `: ${d.reason}` : ""}`;
    case "quote_approved":
      return `Aprobó ${quoteRef(d)} por ${quoteMoney(d, "proposedCents")}`;
    case "quote_exception_approved":
      return `Aprobó ${quoteRef(d)} POR DEBAJO DEL MÍNIMO: ${quoteMoney(d, "proposedCents")} frente a ${quoteMoney(d, "minimumCents")}. Motivo: ${d.reason ?? "—"}`;
    case "quote_sent":
      return `Marcó como enviada ${quoteRef(d)}${d.note ? ` (${d.note})` : ""}`;
    case "quote_accepted":
      return `El cliente aceptó ${quoteRef(d)} por ${quoteMoney(d, "proposedCents")}`;
    case "quote_rejected":
      return `El cliente rechazó ${quoteRef(d)}: ${d.reason ?? "sin motivo"}`;
    case "quote_cancelled":
      return `Canceló ${quoteRef(d)}${d.reason ? `: ${d.reason}` : ""}`;
    case "quote_revised":
      return `Abrió la versión ${d.version ?? "?"} de ${d.number ?? "la cotización"}${d.reason ? `: ${d.reason}` : ""}`;
    case "quote_actual_added":
      return `Registró ${Number(d.hours ?? 0).toLocaleString("es")} h reales en ${quoteRef(d)}${Number(d.costCents) > 0 ? ` y ${quoteMoney({ ...d, currency: "USD" }, "costCents")} de costos` : ""}`;
    case "quote_actual_removed":
      return `Quitó un registro de ${Number(d.hours ?? 0).toLocaleString("es")} h reales de ${quoteRef(d)}`;
    case "assessment_archived":
      return `Archivó el diagnóstico «${d.title ?? ""}»${d.number ? ` (${d.number})` : ""}`;
    case "assessment_restored":
      return `Restauró el diagnóstico «${d.title ?? ""}»${d.number ? ` (${d.number})` : ""}`;
    case "crm_linked":
      return `${d.created ? "Creó una oportunidad en el CRM propio para" : "Enlazó una oportunidad del CRM propio con"} ${d.number ?? `«${d.title ?? ""}»`}`;
    case "crm_unlinked":
      return `Desvinculó ${d.number ?? `«${d.title ?? ""}»`} de su oportunidad del CRM propio`;
    case "pricing_settings_changed": {
      const changed = Array.isArray(d.changed) ? (d.changed as string[]) : [];
      const names: Record<string, string> = {
        currency: "moneda",
        hourlyCostCents: "costo por hora",
        contingencyBp: "contingencia",
        targetMarginBp: "margen objetivo",
        roundingCents: "redondeo",
        validityDays: "vigencia",
        diagnosisFeeCents: "diagnóstico pagado",
        paymentTerms: "condiciones de pago",
        rates: "tarifas",
        templates: "plantillas",
        referenceOffers: "ofertas de referencia",
        crmOrgId: "empresa propia del CRM",
        crmStageId: "etapa de entrada en el CRM",
      };
      return `Cambió los ajustes del cotizador: ${changed.map((k) => names[k] ?? k).join(", ") || "sin cambios"}`;
    }
    default:
      return e.action;
  }
}

const quoteRef = (d: Record<string, unknown>) => `${d.number ?? "COT-?"} v${d.version ?? "?"}`;
const quoteMoney = (d: Record<string, unknown>, key: string) =>
  typeof d[key] === "number" ? `${d.currency ?? "USD"} ${((d[key] as number) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

/** Filas → CSV con comillas, para abrir en Excel. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
