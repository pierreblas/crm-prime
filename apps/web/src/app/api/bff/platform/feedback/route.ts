import { apiForward, relay } from "@/lib/api";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const k of ["kind", "status"]) {
    const v = q.get(k);
    if (v) params.set(k, v);
  }
  return relay(await apiForward(`/platform/feedback?${params.toString()}`));
}
