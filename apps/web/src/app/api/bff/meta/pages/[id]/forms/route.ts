import { apiForward, relay } from "@/lib/api";

// Formularios de la página con su regla (importar y a qué etapa).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return relay(await apiForward(`/meta/pages/${id}/forms`));
}
