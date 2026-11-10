import { assertPublicUrl, UnsafeUrlError } from "../../knowledge/url-import";
import { ConnectorError } from "./types";
import { hostOf } from "./text";

/**
 * `fetch` hacia una dirección que escribió el cliente. Sin cuidado eso es
 * SSRF (pedir la base de datos por la red interna de Docker o los metadatos de
 * la nube), así que la dirección y cada redirección pasan por la misma
 * comprobación que las páginas de la base de conocimiento, con tiempo límite
 * y tope de tamaño. Las credenciales (cabeceras) solo viajan al mismo dominio.
 */

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_BYTES = 15_000_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Driony/1.0 (+https://driony.com; catalogo)";

export interface SafeFetchOptions {
  timeoutMs?: number;
  /** Seguir una redirección a otro dominio (las hojas de Google lo hacen). Las cabeceras no se reenvían. */
  allowCrossHost?: boolean;
}

export async function safeFetch(rawUrl: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  let url = await publicUrl(rawUrl);
  const originalHost = url.hostname;
  let headers: Record<string, string> | undefined = { "User-Agent": USER_AGENT, ...((init.headers as Record<string, string> | undefined) ?? {}) };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new ConnectorError(`${url.hostname} no respondió a tiempo`);
      }
      throw new ConnectorError(`No se pudo conectar con ${url.hostname}${err.cause?.code ? ` (${err.cause.code})` : ""}`);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = await publicUrl(new URL(location, url).toString());
      const sameSite = stripWww(next.hostname) === stripWww(originalHost);
      if (!sameSite && !opts.allowCrossHost) {
        throw new ConnectorError(`${originalHost} redirige a ${next.hostname}: usa esa dirección`);
      }
      // A otro dominio nunca viajan las credenciales.
      if (!sameSite) headers = { "User-Agent": USER_AGENT };
      url = next;
      continue;
    }
    return res;
  }
  throw new ConnectorError("Demasiadas redirecciones");
}

async function publicUrl(raw: string): Promise<URL> {
  try {
    return await assertPublicUrl(raw);
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ConnectorError(e.message);
    throw e;
  }
}

const stripWww = (h: string) => h.replace(/^www\./, "");

/** El cuerpo como texto, con tope de tamaño. */
export async function readText(res: Response, maxBytes = MAX_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ConnectorError("La respuesta es demasiado grande");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson<T>(res: Response): Promise<T> {
  const text = await readText(res);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ConnectorError(`${hostOf(res.url)} no devolvió datos que se entiendan (¿es la dirección correcta?)`);
  }
}
