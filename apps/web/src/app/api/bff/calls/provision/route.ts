import { apiForward, relay } from "@/lib/api";

// Deja Twilio apuntando a los webhooks de Driony.
export async function POST() {
  return relay(await apiForward("/calls/provision", { method: "POST" }));
}
