import { redirect } from "next/navigation";
import type { ImplementationQuote } from "@crm/shared";
import { auth } from "@/auth";
import { apiFetch } from "@/lib/api";
import { isPlatformHost, platformConsoleUrl } from "@/lib/org";
import { ProposalPrint } from "@/features/platform/implementations/ProposalPrint";

/**
 * La propuesta tal como se entrega al cliente, lista para imprimir o guardar
 * como PDF desde el navegador. Solo la cuenta maestra la abre, y solo recibe
 * `publicView`: sin horas, costos internos, márgenes ni mínimos.
 */
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const consoleUrl = platformConsoleUrl();
  if (consoleUrl && !(await isPlatformHost())) redirect(consoleUrl);
  const session = await auth();
  if (!session) redirect("/login");
  if (!(session.user as { platformAdmin?: boolean }).platformAdmin) redirect("/platform");

  const quote = await apiFetch<ImplementationQuote>(`/platform/quotes/${encodeURIComponent(id)}`);
  const approved = quote.status === "APPROVED" || quote.status === "SENT" || quote.status === "ACCEPTED";
  return <ProposalPrint view={quote.publicView} approved={approved} />;
}
