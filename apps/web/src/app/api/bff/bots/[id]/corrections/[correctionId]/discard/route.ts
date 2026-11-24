import { apiForward, relay } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; correctionId: string }> }) {
  const { id, correctionId } = await params;
  return relay(await apiForward(`/bots/${id}/corrections/${correctionId}/discard`, { method: "POST" }));
}
