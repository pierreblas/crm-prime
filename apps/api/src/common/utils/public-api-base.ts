import { env } from "./env";

/**
 * URL pública de la API (sin barra final): la que ven Twilio, los webhooks de
 * etapa y cualquier sistema externo. `API_PUBLIC_URL` manda; si no, se deduce
 * del dominio del SaaS (api.<dominio>). null si no hay forma de saberla.
 */
export function publicApiBase(): string | null {
  const explicit = env("API_PUBLIC_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = env("SAAS_BASE_DOMAIN");
  if (!base) return null;
  const protocolo = base.startsWith("localhost") ? "http" : "https";
  return `${protocolo}://api.${base}`;
}
