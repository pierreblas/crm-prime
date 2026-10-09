import { apiForward, relay } from "@/lib/api";

// Resultado y nota de una llamada (id nuestro o CallSid de Twilio).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/calls/${id}`, { method: "PATCH", body }));
}
