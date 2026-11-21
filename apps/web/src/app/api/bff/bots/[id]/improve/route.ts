import { apiForward, relay } from "@/lib/api";

// «Mejorar agente»: la batería de casos, la última medición y las versiones anteriores de las instrucciones.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/bots/${id}/improve`));
}
