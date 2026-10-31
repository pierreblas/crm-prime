import { apiForward, relay } from "@/lib/api";

// Lee la web de la empresa: puede tardar.
export const maxDuration = 120;

export async function POST() {
  return relay(await apiForward("/onboarding/setup/knowledge", { method: "POST" }));
}
