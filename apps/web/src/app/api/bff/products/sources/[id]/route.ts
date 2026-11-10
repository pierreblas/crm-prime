import { apiForward, relay } from "@/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  return relay(await apiForward(`/products/sources/${id}`, { method: "PATCH", body }));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?products=keep|delete: qué pasa con los productos de la conexión.
  const products = new URL(req.url).searchParams.get("products") === "delete" ? "delete" : "keep";
  return relay(await apiForward(`/products/sources/${id}?products=${products}`, { method: "DELETE" }));
}
