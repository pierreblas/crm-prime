import { apiForward, relay } from "@/lib/api";

/** Enlazar el diagnóstico con una oportunidad del CRM propio (body: CrmLinkInput). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/platform/implementations/${encodeURIComponent(id)}/crm-link`, { method: "POST", body }));
}

/** Quitar el enlace; la oportunidad sigue en el CRM. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/platform/implementations/${encodeURIComponent(id)}/crm-link`, { method: "DELETE" }));
}
