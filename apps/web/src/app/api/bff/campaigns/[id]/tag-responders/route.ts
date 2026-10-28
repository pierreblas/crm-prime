import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/campaigns/${encodeURIComponent(id)}/tag-responders`, { method: "POST", body: await req.text() }));
}
