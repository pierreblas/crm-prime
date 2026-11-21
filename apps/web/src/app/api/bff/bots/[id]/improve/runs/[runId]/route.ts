import { apiForward, relay } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  return relay(await apiForward(`/bots/${id}/improve/runs/${runId}`));
}
