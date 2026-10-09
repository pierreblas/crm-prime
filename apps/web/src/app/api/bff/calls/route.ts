import { apiForward, relay } from "@/lib/api";

// Llamadas de una conversación o de un contacto: ?conversationId= | ?contactId=
export async function GET(req: Request) {
  const { search } = new URL(req.url);
  return relay(await apiForward(`/calls${search}`));
}

// Registrar a mano una llamada.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/calls", { method: "POST", body }));
}
