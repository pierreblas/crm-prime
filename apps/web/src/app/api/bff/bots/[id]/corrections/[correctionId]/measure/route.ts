import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; correctionId: string }> }) {
  const { id, correctionId } = await params;
  return relay(await apiForward(`/bots/${id}/corrections/${correctionId}/measure`, { method: "POST", body: await req.text() }));
}
