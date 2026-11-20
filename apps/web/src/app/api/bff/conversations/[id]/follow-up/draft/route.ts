import { apiForward, relay } from "@/lib/api";

/** Un borrador de lo que redactaría la IA ahora para el próximo seguimiento. No se envía. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/conversations/${id}/follow-up/draft`, { method: "POST" }));
}
