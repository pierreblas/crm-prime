import { apiForward, relay } from "@/lib/api";

/** Citas de un rango (?from&to&userId). */
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  return relay(await apiForward(`/bookings${qs}`));
}

export async function POST(req: Request) {
  const body = await req.text();
  return relay(await apiForward("/bookings", { method: "POST", body }));
}
