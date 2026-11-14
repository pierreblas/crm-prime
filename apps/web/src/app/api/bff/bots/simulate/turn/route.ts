import { apiForward, relay } from "@/lib/api";

// Un paso del simulador: el cliente de mentira escribe y el agente responde.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/bots/simulate/turn", { method: "POST", body }));
}
