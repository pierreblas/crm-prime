import { apiForward, relay } from "@/lib/api";

export async function GET() {
  return relay(await apiForward("/platform/implementations/settings"));
}

export async function PUT(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/platform/implementations/settings", { method: "PUT", body }));
}
