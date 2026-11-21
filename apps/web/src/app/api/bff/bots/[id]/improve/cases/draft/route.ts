import { apiForward, relay } from "@/lib/api";

// El borrador de un caso a partir de un chat real (lo redacta la IA; no guarda nada).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/bots/${id}/improve/cases/draft`, { method: "POST", body: await req.text() }));
}
