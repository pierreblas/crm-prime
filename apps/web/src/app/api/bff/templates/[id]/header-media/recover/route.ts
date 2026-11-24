import { apiForward, relay } from "@/lib/api";

/** Trae de Meta la imagen (o el video, o el documento) con la que aprobó la plantilla. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/templates/${encodeURIComponent(id)}/header-media/recover`, { method: "POST" }));
}
