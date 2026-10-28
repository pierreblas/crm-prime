import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request) {
  return relay(await apiForward("/campaigns/test", { method: "POST", body: await req.text() }));
}
