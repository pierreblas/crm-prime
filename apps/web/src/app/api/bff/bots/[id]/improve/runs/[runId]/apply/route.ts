import { apiForward, relay } from "@/lib/api";

// Pone la propuesta como instrucciones del agente (la anterior queda guardada).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  return relay(await apiForward(`/bots/${id}/improve/runs/${runId}/apply`, { method: "POST", body: await req.text() }));
}
