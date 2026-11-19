import { apiForward, relay } from "@/lib/api";

// La revisión de una conversación del simulador ya terminada.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/bots/simulate/review", { method: "POST", body }));
}
