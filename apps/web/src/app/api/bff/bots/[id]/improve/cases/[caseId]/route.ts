import { apiForward, relay } from "@/lib/api";

type Ctx = { params: Promise<{ id: string; caseId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, caseId } = await params;
  return relay(await apiForward(`/bots/${id}/improve/cases/${caseId}`, { method: "PATCH", body: await req.text() }));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, caseId } = await params;
  return relay(await apiForward(`/bots/${id}/improve/cases/${caseId}`, { method: "DELETE" }));
}
