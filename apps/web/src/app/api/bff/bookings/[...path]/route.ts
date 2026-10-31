import { apiForward, relay } from "@/lib/api";

/**
 * Agenda: reglas, servicios, horarios, horas libres y cada cita. Solo se
 * reenvían estas rutas (y cada una con sus métodos): el comodín no abre nada más.
 */
const ID = "[A-Za-z0-9_-]+";
const ROUTES: { re: RegExp; methods: string[] }[] = [
  { re: /^settings$/, methods: ["GET", "PUT"] },
  { re: /^services$/, methods: ["GET", "POST"] },
  { re: new RegExp(`^services/${ID}$`), methods: ["PATCH", "DELETE"] },
  { re: /^schedules$/, methods: ["GET"] },
  { re: new RegExp(`^schedules/${ID}$`), methods: ["PUT"] },
  { re: /^slots$/, methods: ["GET"] },
  { re: new RegExp(`^contact/${ID}$`), methods: ["GET"] },
  { re: new RegExp(`^${ID}$`), methods: ["PATCH"] },
  { re: new RegExp(`^${ID}/cancel$`), methods: ["POST"] },
];

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, { params }: Ctx) {
  const path = (await params).path.join("/");
  const route = ROUTES.find((r) => r.re.test(path) && r.methods.includes(req.method));
  if (!route) {
    return new Response(JSON.stringify({ message: "No encontrado" }), { status: 404 });
  }
  const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.text();
  const qs = new URL(req.url).search;
  return relay(await apiForward(`/bookings/${path}${qs}`, { method: req.method, ...(body ? { body } : {}) }));
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
