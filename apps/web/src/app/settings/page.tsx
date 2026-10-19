import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { SettingsManager } from "@/features/settings/SettingsManager";

export default async function SettingsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  // Ajustes es configuración del sistema: solo administradores.
  if (role !== "ADMIN") redirect("/");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="settings">
      <SettingsManager hub={!!process.env.SAAS_BASE_DOMAIN} />
    </AppShell>
  );
}
