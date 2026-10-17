import { redirect } from "next/navigation";
import { requireSection } from "@/lib/permissions.server";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { KnowledgeManager } from "@/features/knowledge/KnowledgeManager";

export default async function KnowledgePage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  await requireSection("knowledge");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="knowledge">
      <KnowledgeManager />
    </AppShell>
  );
}
