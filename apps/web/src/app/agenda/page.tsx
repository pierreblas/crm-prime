import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { AgendaView } from "@/features/agenda/AgendaView";

export default async function AgendaPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="agenda">
      <AgendaView />
    </AppShell>
  );
}
