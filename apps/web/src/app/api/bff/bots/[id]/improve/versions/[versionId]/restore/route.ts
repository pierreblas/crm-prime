import { apiForward, relay } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  return relay(await apiForward(`/bots/${id}/improve/versions/${versionId}/restore`, { method: "POST", body: await req.text() }));
}
