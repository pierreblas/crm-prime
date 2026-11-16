import { apiForward, relay } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return relay(await apiForward(`/users/${encodeURIComponent(id)}/password-reset-link`, { method: "POST" }));
}
