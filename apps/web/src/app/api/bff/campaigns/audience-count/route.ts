import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request) {
  return relay(await apiForward("/campaigns/audience-count", { method: "POST", body: await req.text() }));
}
