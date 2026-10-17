import { z } from "zod";

/**
 * Permisos de cada persona del equipo.
 *
 * El rol sigue siendo ADMIN o AGENT. Un administrador lo ve y lo puede todo.
 * A un vendedor (AGENT) el administrador le ajusta tres cosas:
 *  - `scope`: qué chats y contactos ve (todos, los de sus fuentes, o solo los
 *    que tiene asignados).
 *  - `sections`: qué partes del menú puede abrir.
 *  - `actions`: cosas puntuales (ver el teléfono completo, asignar chats a otros).
 *
 * Se guardan en `User.permissions` (JSON). Lo que falte toma el valor por
 * defecto, así un usuario anterior a esta versión sigue viendo lo mismo.
 */

export const visibilityScopes = ["all", "sources", "assigned"] as const;
export type VisibilityScope = (typeof visibilityScopes)[number];
export const SCOPE_LABELS: Record<VisibilityScope, string> = {
  all: "Todos los chats y contactos de la empresa",
  sources: "Solo los de las fuentes que tiene asignadas",
  assigned: "Solo los chats asignados a esta persona",
};

export const permissionSections = ["dashboard", "pipeline", "products", "automation", "knowledge"] as const;
export type PermissionSection = (typeof permissionSections)[number];
export const SECTION_LABELS: Record<PermissionSection, string> = {
  dashboard: "Panel de métricas",
  pipeline: "Embudo de ventas",
  products: "Catálogo de productos",
  automation: "Agentes de IA, flujos y difusiones",
  knowledge: "Base de conocimiento",
};

export const permissionActions = ["seePhone", "reassign"] as const;
export type PermissionAction = (typeof permissionActions)[number];
export const ACTION_LABELS: Record<PermissionAction, string> = {
  seePhone: "Ver el teléfono completo de los contactos",
  reassign: "Asignar chats a otras personas del equipo",
};

export const userPermissionsSchema = z.object({
  scope: z.enum(visibilityScopes),
  sections: z.object({
    dashboard: z.boolean(),
    pipeline: z.boolean(),
    products: z.boolean(),
    automation: z.boolean(),
    knowledge: z.boolean(),
  }),
  actions: z.object({
    seePhone: z.boolean(),
    reassign: z.boolean(),
  }),
});
export type UserPermissions = z.infer<typeof userPermissionsSchema>;

/** Lo que tiene un administrador: todo. */
export const FULL_PERMISSIONS: UserPermissions = {
  scope: "all",
  sections: { dashboard: true, pipeline: true, products: true, automation: true, knowledge: true },
  actions: { seePhone: true, reassign: true },
};

/**
 * Lo que tenía un vendedor antes de existir los permisos: sus fuentes, todas
 * las secciones y sin restricciones. Así nadie pierde nada al actualizar.
 */
export const DEFAULT_AGENT_PERMISSIONS: UserPermissions = {
  scope: "sources",
  sections: { dashboard: true, pipeline: true, products: true, automation: true, knowledge: true },
  actions: { seePhone: true, reassign: true },
};

/** Plantillas para no configurar casilla a casilla. */
export const PERMISSION_PRESETS = {
  seller: {
    label: "Vendedor",
    description: "Atiende sus chats y mueve sus oportunidades. Sin métricas ni automatizaciones, y no reasigna.",
    permissions: {
      scope: "sources",
      sections: { dashboard: false, pipeline: true, products: true, automation: false, knowledge: true },
      actions: { seePhone: true, reassign: false },
    } satisfies UserPermissions,
  },
  supervisor: {
    label: "Supervisor",
    description: "Ve todos los chats y las métricas, reasigna, pero no toca la configuración.",
    permissions: {
      scope: "all",
      sections: { dashboard: true, pipeline: true, products: true, automation: true, knowledge: true },
      actions: { seePhone: true, reassign: true },
    } satisfies UserPermissions,
  },
} as const;
export type PermissionPreset = keyof typeof PERMISSION_PRESETS;

/** Los permisos en vigor: todo para un administrador; lo guardado (o lo por defecto) para un vendedor. */
export function effectivePermissions(role: string, raw: unknown): UserPermissions {
  if (role === "ADMIN") return FULL_PERMISSIONS;
  const parsed = userPermissionsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Tolerante con lo parcial o lo viejo: cada parte que falte, por defecto.
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<{
    scope: unknown;
    sections: Partial<UserPermissions["sections"]>;
    actions: Partial<UserPermissions["actions"]>;
  }>;
  const scope = (visibilityScopes as readonly string[]).includes(String(o.scope)) ? (o.scope as VisibilityScope) : DEFAULT_AGENT_PERMISSIONS.scope;
  return {
    scope,
    sections: { ...DEFAULT_AGENT_PERMISSIONS.sections, ...(o.sections ?? {}) },
    actions: { ...DEFAULT_AGENT_PERMISSIONS.actions, ...(o.actions ?? {}) },
  };
}

/** "+51977060001" → "+51••••••001": se reconoce el país y el final, no se puede marcar. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\s+/g, "");
  if (d.length <= 6) return `${d.slice(0, 1)}${"•".repeat(Math.max(2, d.length - 1))}`;
  return `${d.slice(0, 3)}${"•".repeat(d.length - 6)}${d.slice(-3)}`;
}
