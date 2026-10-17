import { redirect } from "next/navigation";
import { requireSection } from "@/lib/permissions.server";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { ProductsManager } from "@/features/products/ProductsManager";

export default async function ProductsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string })?.role;
  await requireSection("products");

  return (
    <AppShell email={session.user?.email ?? ""} role={role} active="products">
      <ProductsManager />
    </AppShell>
  );
}
