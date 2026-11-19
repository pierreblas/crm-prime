import { apiForward, relay } from "@/lib/api";

// «Revisar ahora»: corre en segundo plano en la API.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/chat-reviews/run", { method: "POST", body: body || "{}" }));
}
