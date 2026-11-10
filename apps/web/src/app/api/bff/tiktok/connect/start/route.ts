import { apiForward, relay } from "@/lib/api";

export async function POST() {
  return relay(await apiForward("/tiktok/connect/start", { method: "POST" }));
}
