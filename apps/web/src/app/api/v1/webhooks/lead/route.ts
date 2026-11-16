import { forwardToApi } from "@/lib/public-api-proxy";

// El webhook de leads en la dirección de cada empresa (flyteek.driony.com/api/v1/webhooks/lead).
// Solo esta ruta de /api/v1: el resto de la API interna no se abre en los subdominios.
export const dynamic = "force-dynamic";

export function POST(req: Request): Promise<Response> {
  return forwardToApi(req, "/api/v1/webhooks/lead");
}
