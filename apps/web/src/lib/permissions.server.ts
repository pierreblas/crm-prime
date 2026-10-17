import { redirect } from "next/navigation";
import type { PermissionSection, PublicUser } from "@crm/shared";
import { apiForward } from "@/lib/api";

/**
 * Una página de sección (panel, embudo, productos…) solo se abre si el
 * usuario tiene esa sección en sus permisos. Un administrador siempre entra.
 * Si la API no responde, no se bloquea: el menú y la propia API ya acotan.
 */
export async function requireSection(section: PermissionSection): Promise<void> {
  let me: PublicUser | null = null;
  try {
    const res = await apiForward("/auth/me");
    if (res.ok) me = (await res.json()) as PublicUser;
  } catch {
    return;
  }
  if (!me || me.role === "ADMIN" || !me.permissions) return;
  if (!me.permissions.sections[section]) redirect("/");
}
