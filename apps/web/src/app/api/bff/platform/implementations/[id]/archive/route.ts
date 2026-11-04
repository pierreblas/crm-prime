import { apiForward, relay } from "@/lib/api";

/** Archivar o restaurar un diagnóstico (body: { archived: boolean }). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/platform/implementations/${encodeURIComponent(id)}/archive`, { method: "POST", body }));
}
