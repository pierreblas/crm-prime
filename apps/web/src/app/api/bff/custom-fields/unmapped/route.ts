import { apiForward, relay } from "@/lib/api";

// Claves que llegan en los contactos sin campo definido.
export async function GET() {
  return relay(await apiForward("/custom-fields/unmapped"));
}
