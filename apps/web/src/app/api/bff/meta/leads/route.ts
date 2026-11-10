import { apiForward, relay } from "@/lib/api";

// Leads recibidos, por estado, página o formulario.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const key of ["status", "pageId", "formId"]) {
    const v = params.get(key);
    if (v) qs.set(key, v);
  }
  const query = qs.toString();
  return relay(await apiForward(`/meta/leads${query ? `?${query}` : ""}`));
}
