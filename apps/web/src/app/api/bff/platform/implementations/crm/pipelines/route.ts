import { apiForward, relay } from "@/lib/api";

/** Embudos y etapas de una empresa, para elegir dónde entran las oportunidades del cotizador. */
export async function GET(req: Request) {
  const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
  return relay(await apiForward(`/platform/implementations/crm/pipelines?orgId=${encodeURIComponent(orgId)}`));
}
