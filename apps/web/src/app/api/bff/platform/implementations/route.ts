import { apiForward, relay } from "@/lib/api";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = new URLSearchParams();
  const search = params.get("search");
  if (search) q.set("search", search);
  if (params.get("archived") === "1") q.set("archived", "1");
  const qs = q.toString();
  return relay(await apiForward(`/platform/implementations${qs ? `?${qs}` : ""}`));
}

export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/platform/implementations", { method: "POST", body }));
}
