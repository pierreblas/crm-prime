import { apiForward, relay } from "@/lib/api";

// Entre elegir páginas y conectarlas: sus formularios, para marcar cuáles entran.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/meta/pages/available/forms", { method: "POST", body }));
}
