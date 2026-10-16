import { NextResponse, type NextRequest } from "next/server";
import {
  REFRESH_UNAVAILABLE_HEADER,
  clearSessionCookieWrites,
  readSessionCookie,
  refreshTokens,
  sessionCookieWrites,
  type CookieWrite,
} from "@/lib/session-token";

/**
 * El middleware hace dos cosas independientes, en este orden:
 *
 *   1. Resuelve el subdominio de la empresa: `acme.driony.com` → "acme".
 *   2. Renueva el access token si está a punto de caducar.
 *
 * Van juntas porque las dos necesitan tocar las cabeceras de la petición antes
 * de que la vea cualquier página, y el middleware es el único sitio del App
 * Router donde eso se puede hacer una sola vez.
 *
 * ── Sobre el subdominio: lo único que hace, y lo que NO hace ──
 * Pone el slug en una cabecera para que las páginas sepan **qué pantalla de
 * acceso enseñar**. No decide de quién son los datos: eso sale del `orgId`
 * firmado dentro del token, y lo comprueba el backend.
 *
 * La diferencia importa. El `Host` lo controla quien llama: con
 * `curl -H "Host: otra-empresa.driony.com"` cualquiera puede decir lo que
 * quiera. Si el subdominio decidiera el acceso, eso sería toda la intrusión.
 *
 * ── Sobre el refresco: por qué aquí ───────────────────────────
 * Es el único punto que puede reescribir la cookie a la vez para el navegador
 * y para la request en curso. Si se refrescara dentro de `auth()` (callback
 * jwt), el refresh token rotado se perdería y el backend acabaría revocando la
 * sesión por "reuso".
 */

const REFRESH_MARGIN_MS = 60_000;

const BASE = (process.env.SAAS_BASE_DOMAIN ?? "").split(":")[0]?.toLowerCase();

/** Subdominios que nunca son una empresa. */
const NO_SON_EMPRESA = new Set(["www", "app", "api", "admin"]);

function slugDe(host: string): string | null {
  if (!BASE) return null; // modo de una sola empresa: no hay subdominios
  const limpio = host.split(":")[0]?.toLowerCase() ?? "";
  if (!limpio.endsWith(`.${BASE}`)) return null;

  const slug = limpio.slice(0, -(BASE.length + 1));
  // Un solo nivel: es lo que cubre el certificado comodín.
  if (!slug || slug.includes(".")) return null;
  if (NO_SON_EMPRESA.has(slug)) return null;
  return slug;
}

/**
 * `admin.<dominio>`: la consola del operador del SaaS. No es una empresa ni
 * el dominio raíz: tiene su propio login y solo sirve la consola.
 */
function esHostDeConsola(host: string): boolean {
  if (!BASE) return false;
  return (host.split(":")[0]?.toLowerCase() ?? "") === `admin.${BASE}`;
}

/** Lo único que existe en el host de la consola. */
const CONSOLA_PERMITIDAS = ["/login", "/platform", "/api/", "/auth/"];

/**
 * Rutas del dominio raíz que existen aunque tengas sesión: el alta, el pase y
 * las de Auth.js. Todo lo demás, con sesión, pertenece a tu subdominio.
 */
const RAIZ_PERMITIDAS = ["/signup", "/handoff", "/api/", "/connect/", "/docs", "/privacy", "/terms", "/data-deletion"];

/**
 * Con sesión y en el dominio raíz, al subdominio de tu empresa.
 *
 * El dominio raíz no tiene app: es la portada y el alta. Quien llega ahí con
 * sesión (un marcador viejo, una sesión de antes del cambio) tiene que acabar
 * en `acme.driony.com`, que es donde vive su cookie de verdad y su panel.
 */
function redirigirASuEmpresa(req: NextRequest, orgSlug: unknown): NextResponse | null {
  if (!BASE || typeof orgSlug !== "string" || !orgSlug) return null;
  const { pathname, search } = req.nextUrl;
  if (RAIZ_PERMITIDAS.some((p) => pathname === p || pathname.startsWith(p))) return null;
  const protocolo = BASE.startsWith("localhost") ? "http" : "https";
  const puerto = (process.env.SAAS_BASE_DOMAIN ?? "").split(":")[1];
  const host = `${orgSlug}.${BASE}${puerto ? `:${puerto}` : ""}`;
  return NextResponse.redirect(`${protocolo}://${host}${pathname}${search}`, 307);
}

/**
 * Escribe el subdominio en las cabeceras de ENTRADA (no en las de salida): así
 * lo leen las páginas y los route handlers con `headers()`, y no se filtra al
 * navegador.
 */
function aplicarOrg(req: NextRequest): void {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const slug = slugDe(host);
  if (slug) req.headers.set("x-org-slug", slug);
  else req.headers.delete("x-org-slug"); // que nadie la inyecte desde fuera
  if (esHostDeConsola(host)) req.headers.set("x-platform-host", "1");
  else req.headers.delete("x-platform-host");
}

/**
 * El conector de Meta (`/connect/…`) vive en el dominio raíz pero se enseña
 * dentro de un modal del panel de cada empresa, en un iframe. Hay que dejar
 * que lo enmarquen los subdominios, y solo ellos. `frame-ancestors` manda
 * sobre cualquier `X-Frame-Options` que añada el proxy.
 */
function permitirMarco(req: NextRequest, res: NextResponse): void {
  if (!req.nextUrl.pathname.startsWith("/connect/")) return;
  let hermanos = "";
  if (BASE) {
    const protocolo = BASE.startsWith("localhost") ? "http" : "https";
    const puerto = (process.env.SAAS_BASE_DOMAIN ?? "").split(":")[1];
    hermanos = ` ${protocolo}://*.${BASE}${puerto ? `:${puerto}` : ""}`;
  }
  res.headers.set("Content-Security-Policy", `frame-ancestors 'self'${hermanos}`);
}

function forward(req: NextRequest, writes: CookieWrite[] = []): NextResponse {
  // La cookie de la request debe quedar lista ANTES de crear la response:
  // NextResponse.next copia las cabeceras en ese momento.
  for (const w of writes) {
    if (w.options.maxAge === 0) req.cookies.delete(w.name);
    else req.cookies.set(w.name, w.value);
  }
  const res = NextResponse.next({ request: { headers: req.headers } });
  for (const w of writes) res.cookies.set(w.name, w.value, w.options);
  permitirMarco(req, res);
  return res;
}

export async function middleware(req: NextRequest) {
  // Nadie de fuera puede fingir estos dos estados.
  req.headers.delete(REFRESH_UNAVAILABLE_HEADER);
  aplicarOrg(req);

  const session = await readSessionCookie(req.cookies);

  // Host de la consola: solo la consola y su login. Lo demás, a la consola.
  const consola = req.headers.get("x-platform-host") === "1";
  if (consola) {
    const { pathname } = req.nextUrl;
    if (!CONSOLA_PERMITIDAS.some((p) => pathname === p || pathname.startsWith(p))) {
      const url = req.nextUrl.clone();
      url.pathname = "/platform";
      url.search = "";
      return NextResponse.redirect(url, 307);
    }
  }

  // Dominio raíz con sesión → al subdominio de la empresa. Va antes del
  // refresco: no tiene sentido renovar una cookie que no debería estar aquí.
  if (session && !consola && !req.headers.get("x-org-slug")) {
    const salto = redirigirASuEmpresa(req, session.token.orgSlug);
    if (salto) return salto;
  }

  const expires = session?.token.accessTokenExpires as number | undefined;
  if (!session || !expires || Date.now() < expires - REFRESH_MARGIN_MS) {
    return forward(req);
  }

  const existing = req.cookies.getAll();
  const reader = { getAll: () => existing };
  const result = await refreshTokens(session.token.refreshToken);

  if (result.kind === "unavailable") {
    // Backend caído o con error: no se echa al usuario, se avisa al BFF.
    req.headers.set(REFRESH_UNAVAILABLE_HEADER, "1");
    return forward(req);
  }

  if (result.kind === "dead") {
    return forward(req, clearSessionCookieWrites(reader));
  }

  const { tokens } = result;
  const token = {
    ...session.token,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpires: Date.now() + tokens.expiresIn * 1000,
    role: tokens.user.role,
    orgSlug: tokens.user.orgSlug ?? session.token.orgSlug,
    platformAdmin: tokens.user.platformAdmin ?? session.token.platformAdmin,
  };
  return forward(req, await sessionCookieWrites(reader, session.name, token));
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!api/auth|auth/expired|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|txt)$).*)",
  ],
};
