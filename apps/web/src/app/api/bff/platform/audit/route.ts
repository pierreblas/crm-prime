import { apiForward, relay } from "@/lib/api";

export async function GET(req: Request) {
  const limit = new URL(req.url).searchParams.get("limit") ?? "100";
  return relay(await apiForward(`/platform/audit?limit=${encodeURIComponent(limit)}`));
}
