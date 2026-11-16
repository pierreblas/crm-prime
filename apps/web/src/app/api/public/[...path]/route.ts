import { forwardToApi } from "@/lib/public-api-proxy";

// La API pública en la dirección de cada empresa (flyteek.driony.com/api/public/v1/…).
// Ver lib/public-api-proxy.ts.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  return forwardToApi(req, `/api/public/${path.map(encodeURIComponent).join("/")}`);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
