import { apiForward, relay } from "@/lib/api";

// Activar o apagar la revisión diaria.
export async function PATCH(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/chat-reviews/settings", { method: "PATCH", body }));
}
