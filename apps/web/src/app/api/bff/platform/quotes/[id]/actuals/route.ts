import { apiForward, relay } from "@/lib/api";

/** Registrar horas y costos reales sobre una versión aceptada. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/platform/quotes/${encodeURIComponent(id)}/actuals`, { method: "POST", body }));
}
