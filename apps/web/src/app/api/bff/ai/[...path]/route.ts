import { apiForward, relay } from "@/lib/api";

/**
 * Copiloto: /api/bff/ai/status, /api/bff/ai/admin-copilot y
 * /api/bff/ai/conversations/:id/{rewrite,summary,ask,memory}.
 * Solo se reenvían esas rutas: el comodín no debe abrir el resto de /ai.
 */
const ALLOWED = /^(status|usage|admin-copilot|conversations\/[A-Za-z0-9_-]+\/(rewrite|summary|ask|memory))$/;

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, { params }: Ctx, method: "GET" | "POST") {
  const path = (await params).path.join("/");
  if (!ALLOWED.test(path)) {
    return new Response(JSON.stringify({ message: "No encontrado" }), { status: 404 });
  }
  const body = method === "POST" ? await req.text() : undefined;
  const qs = new URL(req.url).search;
  return relay(await apiForward(`/ai/${path}${qs}`, { method, ...(body ? { body } : {}) }));
}

export const GET = (req: Request, ctx: Ctx) => forward(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => forward(req, ctx, "POST");
