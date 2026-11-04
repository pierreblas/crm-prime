import { apiForward, relay } from "@/lib/api";

const ACTIONS = new Set(["submit", "reopen", "approve", "send", "accept", "reject", "cancel", "revise"]);

/** Cambio de estado o versión nueva de una cotización. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) return new Response(JSON.stringify({ message: "Acción desconocida" }), { status: 400 });
  const body = await req.text();
  return relay(await apiForward(`/platform/quotes/${encodeURIComponent(id)}/${action}`, { method: "POST", body: body || "{}" }));
}
