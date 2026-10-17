import { redirect } from "next/navigation";
import { requireSection } from "@/lib/permissions.server";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/features/dashboard/Dashboard";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  await requireSection("dashboard");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="dashboard">
      <Dashboard />
    </AppShell>
  );
}
