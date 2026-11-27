/**
 * La dirección pública de la web, sin barra final: la que llevan el canónico,
 * la imagen al compartir, el mapa del sitio y el RSS.
 *
 * Las páginas públicas estáticas (documentación, blog) se escriben en el build,
 * así que ahí tiene que estar ya: el Dockerfile recibe `SAAS_BASE_DOMAIN` y
 * `AUTH_URL` como argumentos de build. `NEXT_PUBLIC_SITE_URL` manda si existe.
 */
export function siteUrl(
  // Escritas una a una: así Next hornea NEXT_PUBLIC_SITE_URL en el build y las otras dos se leen al arrancar.
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    SAAS_BASE_DOMAIN: process.env.SAAS_BASE_DOMAIN,
    AUTH_URL: process.env.AUTH_URL,
  },
): string {
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");
  const explicit = clean(env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit;
  const domain = clean(env.SAAS_BASE_DOMAIN);
  if (domain) return `${/^(localhost|127\.|\[::1\])/.test(domain) ? "http" : "https"}://${domain}`;
  return clean(env.AUTH_URL) || "http://localhost:3000";
}

/** Una ruta del sitio (`/blog/x`) como dirección completa. Lo que ya es completo se deja igual. */
export function absoluteUrl(pathOrUrl: string, base = siteUrl()): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
