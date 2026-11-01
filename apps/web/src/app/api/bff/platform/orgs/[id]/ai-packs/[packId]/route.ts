import { apiForward, relay } from "@/lib/api";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; packId: string }> }) {
  const { id, packId } = await params;
  return relay(
    await apiForward(`/platform/orgs/${encodeURIComponent(id)}/ai-packs/${encodeURIComponent(packId)}`, { method: "DELETE" }),
  );
}
