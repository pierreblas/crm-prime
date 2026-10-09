import { apiForward, relay } from "@/lib/api";

// Token del softphone del navegador.
export async function POST() {
  return relay(await apiForward("/calls/token", { method: "POST" }));
}
