import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/bots/${id}/improve/cases`, { method: "POST", body: await req.text() }));
}
