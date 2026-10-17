import { redirect } from "next/navigation";
import { requireSection } from "@/lib/permissions.server";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { CampaignsManager } from "@/features/campaigns/CampaignsManager";

export default async function DifusionesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  await requireSection("automation");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="campaigns">
      <CampaignsManager />
    </AppShell>
  );
}
