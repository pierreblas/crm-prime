import { apiForward, relay } from "@/lib/api";

// Filtros, orden y página tal cual vienen de la URL de la pantalla.
export async function GET(req: Request) {
  return relay(await apiForward(`/products${new URL(req.url).search}`));
}

export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/products", { method: "POST", body }));
}
