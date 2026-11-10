import { apiForward, relay } from "@/lib/api";

// Vuelve a pasar un lead con la configuración actual de su formulario.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/meta/leads/${encodeURIComponent(id)}/reprocess`, { method: "POST" }));
}
