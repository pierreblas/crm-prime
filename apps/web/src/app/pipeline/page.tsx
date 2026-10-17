import { redirect } from "next/navigation";
import { requireSection } from "@/lib/permissions.server";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { KanbanBoard } from "@/features/pipeline/KanbanBoard";

export default async function PipelinePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  await requireSection("pipeline");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="pipeline">
      <KanbanBoard />
    </AppShell>
  );
}
