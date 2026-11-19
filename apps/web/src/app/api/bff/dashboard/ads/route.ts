import { apiForward, relay } from "@/lib/api";

// Ventas por anuncio (Panel).
export async function GET(req: Request) {
  const period = new URL(req.url).searchParams.get("period");
  return relay(await apiForward(`/dashboard/ads${period ? `?period=${encodeURIComponent(period)}` : ""}`));
}
