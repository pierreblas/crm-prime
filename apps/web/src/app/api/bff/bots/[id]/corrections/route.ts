import { apiForward, relay } from "@/lib/api";

// Lanza una corrección: corre en el servidor y la ventana pregunta por el avance.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/bots/${id}/corrections`, { method: "POST", body: await req.text() }));
}
