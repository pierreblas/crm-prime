import { apiForward, relay } from "@/lib/api";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; actualId: string }> }) {
  const { id, actualId } = await params;
  return relay(await apiForward(`/platform/quotes/${encodeURIComponent(id)}/actuals/${encodeURIComponent(actualId)}`, { method: "DELETE" }));
}
