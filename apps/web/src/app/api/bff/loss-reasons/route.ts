import { apiForward, relay } from "@/lib/api";

export async function GET() {
  return relay(await apiForward("/loss-reasons"));
}

export async function PUT(req: Request) {
  return relay(await apiForward("/loss-reasons", { method: "PUT", body: await req.text() }));
}
