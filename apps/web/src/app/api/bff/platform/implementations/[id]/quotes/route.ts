import { apiForward, relay } from "@/lib/api";

/** Primera versión de la cotización de un diagnóstico. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/platform/implementations/${encodeURIComponent(id)}/quotes`, { method: "POST" }));
}
