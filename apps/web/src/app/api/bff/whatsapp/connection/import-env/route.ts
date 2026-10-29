import { apiForward, relay } from "@/lib/api";

// El número del .env pasa al CRM para poder editarlo y quitarlo.
export async function POST() {
  return relay(await apiForward("/whatsapp/connection/import-env", { method: "POST" }));
}
