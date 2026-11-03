import { apiForward, relay } from "@/lib/api";

// Preguntas de un formulario, para elegir a dónde va cada respuesta.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; formId: string }> },
) {
  const { id, formId } = await params;
  return relay(await apiForward(`/meta/pages/${encodeURIComponent(id)}/forms/${encodeURIComponent(formId)}/questions`));
}
