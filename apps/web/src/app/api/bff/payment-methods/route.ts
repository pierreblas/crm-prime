import { apiForward, relay } from "@/lib/api";

// Métodos de pago de la empresa (Ajustes).
export async function GET() {
  return relay(await apiForward("/payment-methods"));
}

export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/payment-methods", { method: "POST", body }));
}
