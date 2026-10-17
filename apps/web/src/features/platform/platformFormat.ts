import type { PlatformAuditEntry, PlatformOrg } from "@crm/shared";

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

const PLAN_NAMES: Record<string, string> = { free: "Gratis", pro: "Pro", business: "Empresa" };

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
    case "notes_changed":
      return "Editó las notas internas";
    case "login_as":
      return `Entró al panel como ${d.email ?? "administrador"}`;
    default:
      return e.action;
  }
}

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
