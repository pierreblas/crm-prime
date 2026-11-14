import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../common/utils/env";
import { publicApiBase } from "../../common/utils/public-api-base";

/**
 * Enlace de baja de los correos automáticos. El enlace lleva la empresa y la
 * dirección firmadas: no hace falta guardar nada por cada correo enviado y
 * nadie puede dar de baja a otra persona fabricando una URL.
 */

function key(): Buffer {
  const source = env("APP_ENCRYPTION_KEY") ?? env("JWT_ACCESS_SECRET");
  if (!source) throw new Error("Falta APP_ENCRYPTION_KEY (o JWT_ACCESS_SECRET) para firmar los enlaces de baja");
  // Clave propia de este uso: no es la que cifra las credenciales.
  return createHmac("sha256", source).update("driony.email-unsubscribe.v1").digest();
}

const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export function unsubscribeToken(orgId: string, address: string): string {
  const payload = Buffer.from(JSON.stringify([orgId, address.toLowerCase()])).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string | undefined): { orgId: string; address: string } | null {
  if (!token || token.length > 1200) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const [orgId, address] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as [unknown, unknown];
    return typeof orgId === "string" && typeof address === "string" && orgId && address ? { orgId, address } : null;
  } catch {
    return null;
  }
}

/** URL pública de baja, o null si esta instalación no tiene dirección pública configurada. */
export function unsubscribeUrl(orgId: string, address: string): string | null {
  const base = publicApiBase();
  return base ? `${base}/api/v1/email/unsubscribe?t=${unsubscribeToken(orgId, address)}` : null;
}
