import { requireAccessToken } from "@/lib/api";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

// Nota de voz para armar el agente: se reenvía el multipart tal cual (parsearlo
// aquí rompería el boundary) y vuelve el texto.
export async function POST(req: Request) {
  const token = await requireAccessToken();
  if (token instanceof Response) return token;

  const res = await fetch(`${API_URL}/api/v1/bots/transcribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(req.headers.get("content-type") ? { "Content-Type": req.headers.get("content-type")! } : {}),
    },
    body: await req.arrayBuffer(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
