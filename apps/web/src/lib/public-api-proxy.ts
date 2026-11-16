const API_URL = process.env.API_URL ?? "http://localhost:3001";

/** Cabeceras que no se reenvían: las de la conexión, la cookie de sesión y las que pone el middleware. */
const DROP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie",
  "x-org-slug",
  "x-platform-host",
]);
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * La API de cada empresa en su propia dirección, como Kommo:
 * `https://flyteek.driony.com/api/public/v1/…`.
 *
 * El comodín `*.driony.com` llega a la web (es el panel de cada empresa), así
 * que esta ruta reenvía la llamada a la API tal cual, con el `Host` original
 * en `x-forwarded-host`. Con eso la API comprueba que la clave es de la
 * empresa de esa dirección (una clave de Acme en la dirección de Globex da
 * 403). La empresa la sigue decidiendo la clave, nunca la dirección.
 *
 * Se hace aquí, en tiempo de ejecución, y no con un `rewrite` de next.config:
 * esos fijan la dirección de la API al compilar la imagen, y en Docker
 * `API_URL` (http://api:3001) solo existe al arrancar. Así funciona igual
 * detrás de Nginx Proxy Manager, nginx o Caddy, sin tocar el proxy.
 *
 * La cookie de sesión no viaja: la API pública solo acepta claves.
 */
export async function forwardToApi(req: Request, apiPath: string): Promise<Response> {
  // En la nube, solo bajo el subdominio de una empresa (lo marca el middleware);
  // en una instalación propia, en la dirección de la web.
  if (process.env.SAAS_BASE_DOMAIN && !req.headers.get("x-org-slug")) {
    return problem(404, "La API de cada empresa está en su dirección: https://tu-empresa.<dominio>/api/public/v1.");
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-forwarded-host", req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "");

  const search = new URL(req.url).search;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(`${API_URL}${apiPath}${search}`, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    cache: "no-store",
    redirect: "manual",
  }).catch(() => null);
  if (!upstream) return problem(502, "La API no responde. Reintenta en unos segundos.");

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key.toLowerCase())) out.set(key, value);
  });
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
