import { apiForward, relay } from "@/lib/api";

// Todo lo de correo (buzones, plantillas, enviar, historial, bajas) pasa por
// aquí hacia /email/… del API, con la sesión de quien lo pide.
type Ctx = { params: Promise<{ path: string[] }> };

async function target(ctx: Ctx): Promise<string> {
  const { path } = await ctx.params;
  return `/email/${path.map(encodeURIComponent).join("/")}`;
}

export async function GET(_req: Request, ctx: Ctx) {
  return relay(await apiForward(await target(ctx)));
}

export async function POST(req: Request, ctx: Ctx) {
  const body = await req.text();
  return relay(await apiForward(await target(ctx), { method: "POST", body: body || undefined }));
}

export async function PATCH(req: Request, ctx: Ctx) {
  const body = await req.text();
  return relay(await apiForward(await target(ctx), { method: "PATCH", body }));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return relay(await apiForward(await target(ctx), { method: "DELETE" }));
}
