import { apiForward, relay } from "@/lib/api";

// Revisión de chats reales: lo revisado y el estado de la pasada diaria.
export async function GET(req: Request) {
  return relay(await apiForward(`/chat-reviews${new URL(req.url).search}`));
}
