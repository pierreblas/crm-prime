import { apiForward, relay } from "@/lib/api";

/** Oportunidades abiertas y contactos del CRM propio que coinciden con el texto. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return relay(await apiForward(`/platform/implementations/crm/search?q=${encodeURIComponent(q)}`));
}
