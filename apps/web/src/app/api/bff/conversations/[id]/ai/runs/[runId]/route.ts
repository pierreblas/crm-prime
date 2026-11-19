import { apiForward, relay } from "@/lib/api";

// «¿Por qué respondió esto?»: qué entendió, qué consultó y qué hizo la IA en esa respuesta.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  return relay(await apiForward(`/conversations/${id}/ai/runs/${encodeURIComponent(runId)}`));
}
