import { apiForward, relay } from "@/lib/api";

/** El archivo del encabezado que sale en los envíos que no eligen otro. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/templates/${encodeURIComponent(id)}/header-media`, { method: "PUT", body }));
}
