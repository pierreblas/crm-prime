import { apiForward, relay } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return relay(
    await apiForward(`/platform/orgs/${encodeURIComponent(id)}/users/${encodeURIComponent(userId)}/password-reset-link`, {
      method: "POST",
    }),
  );
}
