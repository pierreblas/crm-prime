import { env } from "../../common/utils/env";
import { tenancyMode } from "../../infra/tenant/tenant.context";

/**
 * Llamadas salientes a los proveedores de IA: un solo sitio que decide a qué
 * hosts se puede hablar y cuánto se espera.
 *
 * La «URL base» de OpenAI la escribe un administrador de la empresa en Ajustes
 * y la API la llama desde su propia red: sin esta lista, cualquier administrador
 * podría apuntar la API a una dirección interna (SSRF) o a un servidor que no
 * responde nunca. En SaaS solo se admiten hosts conocidos (más los que el
 * operador añada en AI_ALLOWED_BASE_HOSTS) y siempre por https. En una
 * instalación propia el servidor es de la empresa y vale cualquier URL
 * (Ollama en la red local, por ejemplo).
 */
export const AI_TIMEOUT_CHAT_MS = 60_000;
export const AI_TIMEOUT_AUDIO_MS = 120_000;

/** Proveedores con API compatible con OpenAI que la documentación menciona, más Anthropic. */
const DEFAULT_HOSTS = ["api.openai.com", "api.anthropic.com", "api.groq.com", "api.deepseek.com", "openrouter.ai"];

/** Hosts admitidos en SaaS: los conocidos, los del operador y el de OPENAI_BASE_URL si lo fijó él. */
export function allowedAiHosts(): Set<string> {
  const extra = (env("AI_ALLOWED_BASE_HOSTS") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const operator = hostOf(env("OPENAI_BASE_URL"));
  return new Set([...DEFAULT_HOSTS, ...extra, ...(operator ? [operator] : [])]);
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/i;
const IP_LITERAL = /^(\d+\.\d+\.\d+\.\d+|\[.*\])$/;

/**
 * Por qué una URL de proveedor no se admite, o null si vale. Se aplica al
 * guardar la URL base y otra vez en cada llamada (por si la lista cambió).
 */
export function providerUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "no es una URL válida";
  }
  if (url.username || url.password) return "no puede llevar usuario ni contraseña";
  const host = url.hostname.toLowerCase();
  if (tenancyMode !== "multi") {
    return url.protocol === "https:" || url.protocol === "http:" ? null : "debe empezar por https:// o http://";
  }
  if (url.protocol !== "https:") return "debe empezar por https://";
  if (IP_LITERAL.test(host) || PRIVATE_HOST.test(host)) return "no puede ser una dirección IP ni un host interno";
  if (!allowedAiHosts().has(host)) {
    return `el host ${host} no está entre los proveedores admitidos (pide al operador que lo añada en AI_ALLOWED_BASE_HOSTS)`;
  }
  return null;
}

/** La URL base limpia (sin barra final) o un error con el motivo. */
export function normalizeProviderBaseUrl(raw: string): string {
  const problem = providerUrlProblem(raw);
  if (problem) throw new Error(`URL base no admitida: ${problem}`);
  return raw.trim().replace(/\/+$/, "");
}

/**
 * `fetch` hacia un proveedor de IA: comprueba el host y aborta al pasar el
 * tiempo. Un timeout o un fallo de red se convierten en un error legible,
 * nunca en una llamada colgada.
 */
export async function aiFetch(url: string, init: RequestInit, timeoutMs = AI_TIMEOUT_CHAT_MS): Promise<Response> {
  const problem = providerUrlProblem(url);
  if (problem) throw new Error(`El proveedor de IA configurado no se admite: ${problem}`);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error & { cause?: { message?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error(`El proveedor de IA (${hostOf(url) ?? "?"}) no respondió en ${Math.round(timeoutMs / 1000)} s`);
    }
    throw new Error(`No se pudo conectar con el proveedor de IA (${hostOf(url) ?? "?"}): ${err.cause?.message ?? err.message}`);
  }
}

/**
 * Qué dice un error del proveedor sobre la clave: 401/403 → rechazada,
 * 429 → sin cuota. Cualquier otra cosa (red, timeout, 5xx) no dice nada de ella.
 */
export function credentialStatusFromError(e: unknown): "invalid" | "exhausted" | null {
  const status = (e as { status?: number })?.status;
  const msg = (e as Error)?.message ?? "";
  const code = typeof status === "number" ? status : Number(/\b(401|403|429)\b/.exec(msg)?.[1] ?? 0);
  if (code === 401 || code === 403) return "invalid";
  if (code === 429) return "exhausted";
  return null;
}
