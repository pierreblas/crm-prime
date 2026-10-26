import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/feedback", { method: "POST", body }));
}
