import { apiForward, relay } from "@/lib/api";

export async function GET() {
  return relay(await apiForward("/calls/config"));
}
