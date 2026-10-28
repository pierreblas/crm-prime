import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request) {
  return relay(await apiForward("/deals/bulk", { method: "POST", body: await req.text() }));
}
