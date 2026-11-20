import { apiForward, relay } from "@/lib/api";

/** El próximo seguimiento del chat: qué toque es, cuándo sale y qué va a decir. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/conversations/${id}/follow-up`));
}

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
