import { redirect } from "next/navigation";
import { requireSection } from "@/lib/permissions.server";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { BotsManager } from "@/features/bots/BotsManager";

export default async function AgentesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  await requireSection("automation");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="bots">
      <BotsManager />
    </AppShell>
  );
}
