import { apiForward, relay } from "@/lib/api";

// Conecta el conjunto de datos (píxel) de Meta de una página, para los leads de sus formularios.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/conversions/forms/${id}/enable`, { method: "POST", body }));
}
