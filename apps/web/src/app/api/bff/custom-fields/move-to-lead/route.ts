import { apiForward, relay } from "@/lib/api";

// Un dato que estaba en los contactos pasa a ser campo del lead, con lo que ya había.
export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/custom-fields/move-to-lead", { method: "POST", body }));
}
