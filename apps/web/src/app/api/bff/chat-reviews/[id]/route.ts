import { apiForward, relay } from "@/lib/api";

// Marcar una revisión como vista (o volver a dejarla para mirar).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/chat-reviews/${encodeURIComponent(id)}`, { method: "PATCH", body }));
}
