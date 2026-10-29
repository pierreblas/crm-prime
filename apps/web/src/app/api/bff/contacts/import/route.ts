import { apiForward, relay } from "@/lib/api";

// Importar contactos (filas ya validadas en el navegador).
export async function POST(req: Request) {
  return relay(await apiForward("/contacts/import", { method: "POST", body: await req.text() }));
}
