import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TIKTOK_SCOPES } from "@crm/shared";
import { env } from "../../common/utils/env";
import { PrismaService } from "../../infra/prisma/prisma.service";

/**
 * Llamadas a la Business Messaging API de TikTok.
 *
 * La app es la de la plataforma (TIKTOK_APP_ID / TIKTOK_APP_SECRET). Cada
 * cuenta de empresa autoriza en tiktok.com y nos deja un token de un día con
 * un refresco de 30 días: `validToken` lo renueva y lo guarda. Todo lo demás
 * es `business/...` con el token en la cabecera `Access-Token`. Contrato
 * tomado de la referencia pública de TikTok y contrastado con una
 * implementación abierta (Chatwoot, 2025).
 */
export interface TikTokCreds {
  businessId: string;
  accessToken: string;
}

export interface TikTokTokens {
  businessId: string;
  scope: string[];
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  refreshExpiresAt: Date;
}

export class TikTokApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

type TikTokEnvelope<T> = { code?: number; message?: string; request_id?: string; data?: T };

const TOKEN_MARGIN_MS = 5 * 60_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

@Injectable()
export class TikTokClient {
  private readonly logger = new Logger("TikTok");

  constructor(private readonly prisma: PrismaService) {}

  /** Hay app de TikTok en el servidor: sin ella no se puede conectar ninguna cuenta. */
  get configured(): boolean {
    return !!(env("TIKTOK_APP_ID") && env("TIKTOK_APP_SECRET"));
  }

  private get appId(): string {
    return env("TIKTOK_APP_ID") ?? "";
  }

  private get appSecret(): string {
    return env("TIKTOK_APP_SECRET") ?? "";
  }

  private get base(): string {
    return `${env("TIKTOK_API_URL") ?? "https://business-api.tiktok.com"}/open_api/${env("TIKTOK_API_VERSION") ?? "v1.3"}`;
  }

  // ── Autorización ─────────────────────────────────────────────
  /** A dónde mandar al administrador para que autorice su cuenta. `state` es nuestro pase de un solo uso. */
  authorizeUrl(redirectUri: string, state: string): string {
    const q = new URLSearchParams({
      client_key: this.appId,
      response_type: "code",
      scope: TIKTOK_SCOPES.join(","),
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize?${q.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TikTokTokens> {
    const data = await this.call<{
      open_id?: string;
      scope?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
    }>("tt_user/oauth2/token/", {
      method: "POST",
      body: { client_id: this.appId, client_secret: this.appSecret, grant_type: "authorization_code", auth_code: code, redirect_uri: redirectUri },
      what: "canjear la autorización de TikTok",
    });
    if (!data.open_id || !data.access_token || !data.refresh_token) throw new TikTokApiError("TikTok no devolvió los tokens de la cuenta", null);
    const now = Date.now();
    return {
      businessId: data.open_id,
      scope: (data.scope ?? "").split(",").filter(Boolean),
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(now + (data.expires_in ?? 86_400) * 1000),
      refreshExpiresAt: new Date(now + (data.refresh_token_expires_in ?? 30 * 86_400) * 1000),
    };
  }

  async refresh(refreshToken: string): Promise<Omit<TikTokTokens, "businessId" | "scope">> {
    const data = await this.call<{ access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>(
      "tt_user/oauth2/refresh_token/",
      {
        method: "POST",
        body: { client_id: this.appId, client_secret: this.appSecret, grant_type: "refresh_token", refresh_token: refreshToken },
        what: "renovar el token de TikTok",
      },
    );
    if (!data.access_token || !data.refresh_token) throw new TikTokApiError("TikTok no devolvió el token renovado", null);
    const now = Date.now();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(now + (data.expires_in ?? 86_400) * 1000),
      refreshExpiresAt: new Date(now + (data.refresh_token_expires_in ?? 30 * 86_400) * 1000),
    };
  }

  /**
   * Un token que sirva ahora: el guardado si le quedan más de cinco minutos;
   * si no, se renueva y se guarda. Sin refresco vivo, la cuenta pasa a
   * «volver a autorizar» y el envío falla con un mensaje que lo dice.
   */
  async validToken(acc: { id: string; accessToken: string; refreshToken: string; tokenExpiresAt: Date; refreshExpiresAt: Date }): Promise<string> {
    if (acc.tokenExpiresAt.getTime() - TOKEN_MARGIN_MS > Date.now()) return acc.accessToken;
    const expiredMsg = "La autorización de TikTok caducó: vuelve a conectar la cuenta en Ajustes › Canales › TikTok.";
    if (acc.refreshExpiresAt.getTime() <= Date.now()) {
      await this.markReauth(acc.id, expiredMsg);
      throw new TikTokApiError(expiredMsg, null);
    }
    try {
      const t = await this.refresh(acc.refreshToken);
      await this.prisma.tikTokAccount.update({
        where: { id: acc.id },
        data: {
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
          tokenExpiresAt: t.tokenExpiresAt,
          refreshExpiresAt: t.refreshExpiresAt,
          status: "connected",
          statusReason: null,
        },
      });
      return t.accessToken;
    } catch (e) {
      await this.markReauth(acc.id, (e as Error).message);
      throw e;
    }
  }

  private async markReauth(id: string, reason: string): Promise<void> {
    await this.prisma.tikTokAccount
      .update({ where: { id }, data: { status: "reauth_required", statusReason: reason.slice(0, 300) } })
      .catch(() => undefined);
  }

  // ── Cuenta ───────────────────────────────────────────────────
  async accountDetails(creds: TikTokCreds): Promise<{ username: string | null; displayName: string | null; avatarUrl: string | null }> {
    const data = await this.call<{ username?: string; display_name?: string; profile_image?: string }>("business/get/", {
      method: "GET",
      token: creds.accessToken,
      query: { business_id: creds.businessId, fields: JSON.stringify(["username", "display_name", "profile_image"]) },
      what: "leer la cuenta de TikTok",
    });
    return { username: data.username ?? null, displayName: data.display_name ?? null, avatarUrl: data.profile_image ?? null };
  }

  // ── Mensajes ─────────────────────────────────────────────────
  async sendText(creds: TikTokCreds, conversationId: string, text: string, replyToMessageId?: string): Promise<{ messageId: string }> {
    return this.send(creds, conversationId, { message_type: "TEXT", text: { body: text } }, replyToMessageId);
  }

  /** Solo JPG o PNG de hasta 3 MB: se sube primero y se manda por su media_id. */
  async sendImage(
    creds: TikTokCreds,
    conversationId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
    replyToMessageId?: string,
  ): Promise<{ messageId: string }> {
    if (!/^image\/(jpeg|png)$/i.test(mimeType)) throw new TikTokApiError("TikTok solo admite imágenes JPG o PNG.", null);
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new TikTokApiError("TikTok solo admite imágenes de hasta 3 MB.", null);
    const form = new FormData();
    form.append("business_id", creds.businessId);
    form.append("media_type", "IMAGE");
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename.replace(/[^\x20-\x7e]/g, "_") || "imagen");
    const up = await this.call<{ media_id?: string }>("business/message/media/upload/", {
      method: "POST",
      token: creds.accessToken,
      form,
      what: "subir la imagen a TikTok",
    });
    if (!up.media_id) throw new TikTokApiError("TikTok no devolvió el id de la imagen", null);
    return this.send(creds, conversationId, { message_type: "IMAGE", image: { media_id: up.media_id } }, replyToMessageId);
  }

  private async send(creds: TikTokCreds, conversationId: string, message: Record<string, unknown>, replyToMessageId?: string): Promise<{ messageId: string }> {
    const data = await this.call<{ message?: { message_id?: string } }>("business/message/send/", {
      method: "POST",
      token: creds.accessToken,
      body: {
        business_id: creds.businessId,
        recipient_type: "CONVERSATION",
        recipient: conversationId,
        ...message,
        ...(replyToMessageId ? { referenced_message_info: { referenced_message_id: replyToMessageId } } : {}),
      },
      what: "enviar por TikTok",
    });
    const id = data.message?.message_id;
    if (!id) throw new TikTokApiError("TikTok no devolvió el id del mensaje", null);
    return { messageId: id };
  }

  /** La imagen de un mensaje entrante: TikTok da una URL temporal que exige el token en la cabecera x-user. */
  async downloadImage(creds: TikTokCreds, conversationId: string, messageId: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const data = await this.call<{ download_url?: string }>("business/message/media/download/", {
      method: "POST",
      token: creds.accessToken,
      body: { business_id: creds.businessId, conversation_id: conversationId, message_id: messageId, media_id: mediaId, media_type: "IMAGE" },
      what: "pedir la imagen a TikTok",
    });
    if (!data.download_url) throw new TikTokApiError("TikTok no devolvió la URL de la imagen", null);
    const res = await fetch(data.download_url, { headers: { "x-user": creds.accessToken } });
    if (!res.ok) throw new TikTokApiError(`No se pudo descargar la imagen de TikTok (${res.status})`, null);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim(),
    };
  }

  // ── Webhook de la app ────────────────────────────────────────
  /** La URL que TikTok tiene registrada para los avisos de mensajes (null si ninguna). */
  async webhookCallbackUrl(): Promise<string | null> {
    const data = await this.call<{ callback_url?: string }>("business/webhook/list/", {
      method: "GET",
      query: { app_id: this.appId, secret: this.appSecret, event_type: "DIRECT_MESSAGE" },
      what: "leer el webhook de TikTok",
    });
    return data.callback_url ?? null;
  }

  async setWebhookCallbackUrl(callbackUrl: string): Promise<void> {
    await this.call("business/webhook/update/", {
      method: "POST",
      body: { app_id: this.appId, secret: this.appSecret, event_type: "DIRECT_MESSAGE", callback_url: callbackUrl },
      what: "registrar el webhook de TikTok",
    });
  }

  verifySignature(header: string | undefined, rawBody: Buffer | string): boolean {
    return verifyTikTokSignature(this.appSecret, header, rawBody);
  }

  // ── Transporte ───────────────────────────────────────────────
  private async call<T>(
    path: string,
    opts: { method: "GET" | "POST"; token?: string; query?: Record<string, string>; body?: unknown; form?: FormData; what: string },
  ): Promise<T> {
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.token) headers["Access-Token"] = opts.token;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    const json = (await res.json().catch(() => null)) as TikTokEnvelope<T> | null;
    if (!res.ok || !json || (json.code ?? 0) !== 0) {
      const msg = explainTikTokError(json?.code ?? null, json?.message ?? `HTTP ${res.status}`);
      this.logger.warn(`No se pudo ${opts.what}: ${msg}`);
      throw new TikTokApiError(msg, json?.code ?? null);
    }
    return (json.data ?? {}) as T;
  }
}

/**
 * Firma de los webhooks de TikTok: cabecera `Tiktok-Signature: t=<unix>,s=<hex>`,
 * HMAC-SHA256 de «<t>.<cuerpo crudo>» con el secreto de la app. Se admiten
 * cinco minutos de desfase (TikTok reintenta los avisos que no respondimos).
 */
export function verifyTikTokSignature(
  secret: string,
  header: string | undefined,
  rawBody: Buffer | string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!secret || !header) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  const s = parts.s;
  if (!Number.isFinite(t) || !s) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Los errores de TikTok que un vendedor puede entender o arreglar, en su idioma. */
export function explainTikTokError(code: number | null, raw: string): string {
  if (/only business account/i.test(raw)) {
    return "Esta cuenta de TikTok no tiene acceso avanzado: vincúlala a TikTok for Business o Business Center y vuelve a conectarla.";
  }
  if (/token|unauthorized|access denied/i.test(raw) || code === 40100 || code === 40105) {
    return "La autorización de TikTok caducó o se revocó: vuelve a conectar la cuenta en Ajustes › Canales › TikTok.";
  }
  if (/window|48|expired|time limit/i.test(raw)) return "Pasaron más de 48 h desde el último mensaje del cliente: TikTok ya no deja responder.";
  if (/limit|quota|frequency/i.test(raw)) return "TikTok limitó los envíos de esta conversación (hasta 10 mensajes por cada vez que el cliente escribe).";
  return raw;
}
