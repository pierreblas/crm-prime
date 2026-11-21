import { apiForward, relay } from "@/lib/api";

// Las conversaciones de una versión (y de un caso) de la medición.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  return relay(await apiForward(`/bots/${id}/improve/runs/${runId}/results${new URL(req.url).search}`));
}
