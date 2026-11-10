import { apiForward, relay } from "@/lib/api";

// Trae los leads anteriores del formulario (los que Meta aún guarda).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; formId: string }> },
) {
  const { id, formId } = await params;
  return relay(
    await apiForward(`/meta/pages/${encodeURIComponent(id)}/forms/${encodeURIComponent(formId)}/import`, { method: "POST" }),
  );
}
