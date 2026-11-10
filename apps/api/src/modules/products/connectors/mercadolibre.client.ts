import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { MERCADO_LIBRE_SITES, type MercadoLibreSiteId } from "@crm/shared";
import { env } from "../../../common/utils/env";
import { sleep } from "./text";
import { ConnectorError } from "./types";

/**
 * Llamadas a la API de Mercado Libre (api.mercadolibre.com).
 *
 * La app es la de la plataforma (MERCADOLIBRE_APP_ID / MERCADOLIBRE_APP_SECRET),
 * registrada en el portal de desarrolladores del país. Cada vendedor autoriza
 * en auth.mercadolibre.<país> y deja un token de 6 horas con un refresh token
 * de 6 meses que es de UN SOLO USO: cada renovación devuelve otro y el
 * anterior deja de valer, así que quien renueva tiene que guardarlo al
 * momento. Contrato tomado de la documentación pública de Mercado Libre
 * (autenticación y autorización, ítems y búsquedas, notificaciones) y
 * contrastado con integraciones abiertas (2025-2026).
 */

const API = "https://api.mercadolibre.com";
const TIMEOUT_MS = 25_000;
const RETRIES_429 = 3;
const DEFAULT_EXPIRES_S = 21_600; // 6 h

export interface MercadoLibreTokens {
  accessToken: string;
  refreshToken: string;
  /** Instante (ms) en que caduca el token de acceso. */
  expiresAt: number;
  userId: string;
  scope: string;
}

export interface MercadoLibreMe {
  id: number;
  nickname?: string;
  site_id?: string;
  country_id?: string;
}

/** Error de la API con su código HTTP: 401 pide renovar el token; el resto se explica al usuario. */
export class MercadoLibreApiError extends ConnectorError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

@Injectable()
export class MercadoLibreClient {
  /** Hay app de Mercado Libre en el servidor: sin ella no se puede conectar ningún vendedor. */
  get configured(): boolean {
    return !!(env("MERCADOLIBRE_APP_ID") && env("MERCADOLIBRE_APP_SECRET"));
  }

  get appId(): string {
    return env("MERCADOLIBRE_APP_ID") ?? "";
  }

  private get appSecret(): string {
    return env("MERCADOLIBRE_APP_SECRET") ?? "";
  }

  /** PKCE (S256): el verificador se queda en el servidor; a la URL solo va el reto. */
  static pkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
  }

  /** A dónde mandar al administrador para que autorice su cuenta de vendedor. `state` es nuestro pase de un solo uso. */
  authorizeUrl(site: MercadoLibreSiteId, redirectUri: string, state: string, codeChallenge: string): string {
    const host = MERCADO_LIBRE_SITES.find((s) => s.id === site)?.authHost;
    if (!host) throw new ConnectorError(`País de Mercado Libre desconocido: ${site}`);
    const q = new URLSearchParams({
      response_type: "code",
      client_id: this.appId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `https://${host}/authorization?${q.toString()}`;
  }

  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<MercadoLibreTokens> {
    return this.token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
  }

  refresh(refreshToken: string): Promise<MercadoLibreTokens> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async token(params: Record<string, string>): Promise<MercadoLibreTokens> {
    const body = new URLSearchParams({ client_id: this.appId, client_secret: this.appSecret, ...params });
    const res = await this.request(`${API}/oauth/token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user_id?: number | string;
      scope?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok || !data.access_token) {
      if (data.error === "invalid_grant") {
        throw new MercadoLibreApiError("Mercado Libre ya no acepta la autorización guardada (caducó o se revocó): vuelve a conectar la cuenta", res.status);
      }
      throw new MercadoLibreApiError(`Mercado Libre no entregó el token (${res.status}): ${data.message ?? data.error ?? "sin detalle"}`, res.status);
    }
    if (!data.refresh_token) {
      throw new MercadoLibreApiError("Mercado Libre no devolvió refresh token: la app necesita el permiso «Offline access» (acceso sin conexión)", res.status);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (Number(data.expires_in) || DEFAULT_EXPIRES_S) * 1000,
      userId: String(data.user_id ?? ""),
      scope: String(data.scope ?? ""),
    };
  }

  me(token: string): Promise<MercadoLibreMe> {
    return this.get<MercadoLibreMe>("/users/me", token);
  }

  /** GET con el token del vendedor (o sin token, para lo público). Reintenta ante 429; el 401 lo resuelve quien llama renovando el token. */
  async get<T>(path: string, token: string | null): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.request(`${API}${path}`, {
        headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
      if (res.status === 429 && attempt < RETRIES_429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok) {
        const detail = (data as { message?: string } | null)?.message ?? text.slice(0, 200);
        throw new MercadoLibreApiError(explain(res.status, detail), res.status);
      }
      return data as T;
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") throw new ConnectorError("Mercado Libre no respondió a tiempo");
      throw new ConnectorError(`No se pudo conectar con Mercado Libre (${err.message})`);
    }
  }
}

function explain(status: number, detail: string): string {
  if (status === 401) return "Mercado Libre rechazó el token de acceso";
  if (status === 403) return `Mercado Libre no permite esta lectura (403): la app necesita permiso de lectura sobre la cuenta. ${detail}`.trim();
  if (status === 404) return `Mercado Libre no encuentra el recurso (404). ${detail}`.trim();
  if (status === 429) return "Mercado Libre limitó las peticiones (429): se volverá a intentar en la siguiente lectura";
  return `Mercado Libre respondió ${status}: ${detail}`;
}
