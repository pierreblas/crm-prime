import { apiForward, relay } from "@/lib/api";

// La IA redacta las instrucciones del agente: puede tardar.
export const maxDuration = 120;

export async function POST() {
  return relay(await apiForward("/onboarding/setup/agent", { method: "POST" }));
}
