import { apiForward, relay } from "@/lib/api";

// Nuevo orden de la lista.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/payment-methods/reorder", { method: "POST", body }));
}
