import { apiForward, relay } from "@/lib/api";

/** Cancela el seguimiento automático programado en un chat. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return relay(
    await apiForward(`/conversations/${id}/follow-up`, { method: "DELETE" }),
  );
}
