import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/platform/orgs/${encodeURIComponent(id)}/ai-packs`, { method: "POST", body }));
}
