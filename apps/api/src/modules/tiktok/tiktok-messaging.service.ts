import { Inject, Injectable, Logger } from "@nestjs/common";
import { MessageType, TIKTOK_WINDOW_HOURS, socialId } from "@crm/shared";
import type { TikTokAccount } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { STORAGE_PROVIDER, toStorageRef, type StorageProvider } from "../../infra/storage/storage.provider";
import { MessagingService, type SocialChannelRef } from "../messaging/messaging.service";
import { TikTokClient } from "../messaging/tiktok.client";

/**
 * Un aviso del webhook de TikTok. `content` llega como texto JSON (a veces ya
 * como objeto); `user_openid` es la cuenta de empresa que recibe o envía.
 *   im_receive_msg  → el cliente escribió
 *   im_send_msg     → la cuenta escribió (lo nuestro vuelve como eco; lo de la app de TikTok, no)
 *   im_mark_read_msg → el cliente leyó hasta cierta hora
 */
export interface TikTokEvent {
  event?: string;
  user_openid?: string;
  content?: unknown;
  create_time?: number;
}

export interface TikTokContent {
  conversation_id?: string;
  message_id?: string;
  type?: string; // text | image | sticker | share_post | ...
  text?: { body?: string };
  image?: { media_id?: string };
  share_post?: { embed_url?: string };
  referenced_message_info?: { referenced_message_id?: string };
  timestamp?: number;
  from?: string;
  from_user?: { id?: string };
  to?: string;
  to_user?: { id?: string };
  read?: { last_read_timestamp?: number | string };
}

export const TIKTOK_EVENTS = ["im_receive_msg", "im_send_msg", "im_mark_read_msg"] as const;

export function parseTikTokContent(raw: unknown): TikTokContent | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as TikTokContent;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as TikTokContent) : null;
  } catch {
    return null;
  }
}

@Injectable()
export class TikTokMessagingService {
  private readonly logger = new Logger("TikTok");

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly client: TikTokClient,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async dispatch(event: TikTokEvent, account: TikTokAccount): Promise<void> {
    const content = parseTikTokContent(event.content);
    if (!content?.conversation_id) {
      this.logger.debug(`Aviso ${event.event ?? "?"} sin conversación: se ignora`);
      return;
    }
    const social: SocialChannelRef = {
      kind: "tiktok",
      tiktokAccountId: account.id,
      externalId: content.conversation_id,
      since: account.connectedAt,
      label: account.username ? `@${account.username}` : (account.displayName ?? "TikTok"),
      pipelineId: account.pipelineId,
      sourceId: account.sourceId,
      windowMs: TIKTOK_WINDOW_HOURS * 3_600_000,
    };
    void this.prisma.tikTokAccount.update({ where: { id: account.id }, data: { lastWebhookAt: new Date() } }).catch(() => undefined);

    switch (event.event) {
      case "im_receive_msg":
        return this.inbound(content, social, account);
      case "im_send_msg":
        return this.echo(content, social, account);
      case "im_mark_read_msg": {
        const reader = content.from_user?.id;
        if (!reader || reader === account.businessId) return; // lo leímos nosotros
        const ts = Number(content.read?.last_read_timestamp ?? content.timestamp ?? Date.now());
        return this.messaging.markReadUpTo(socialId("tiktok", reader), ts);
      }
      default:
        this.logger.debug(`Aviso de TikTok sin tratar: ${event.event ?? "?"}`);
    }
  }

  private async inbound(c: TikTokContent, social: SocialChannelRef, account: TikTokAccount): Promise<void> {
    const userId = c.from_user?.id;
    const mid = c.message_id;
    if (!userId || !mid) return;
    const body = await this.content(c, account);
    await this.messaging.handleInbound({
      from: socialId("tiktok", userId),
      // TikTok manda el usuario (@) de quien escribe; no hay nombre aparte.
      name: c.from || undefined,
      username: c.from || undefined,
      waMessageId: mid,
      type: body.type,
      text: body.text,
      note: body.note,
      mediaUrl: body.mediaUrl,
      replyToWaMessageId: c.referenced_message_info?.referenced_message_id,
      timestampMs: c.timestamp,
      social,
    });
  }

  private async echo(c: TikTokContent, social: SocialChannelRef, account: TikTokAccount): Promise<void> {
    const userId = c.to_user?.id;
    const mid = c.message_id;
    if (!userId || !mid) return;
    const body = await this.content(c, account);
    await this.messaging.handleSocialEcho({
      social,
      to: socialId("tiktok", userId),
      mid,
      type: body.type,
      text: body.text,
      note: body.note,
      mediaUrl: body.mediaUrl,
    });
  }

  /** Texto, imagen (descargada al almacén) o una nota que explique lo que TikTok no deja mostrar. */
  private async content(c: TikTokContent, account: TikTokAccount): Promise<{ type: MessageType; text?: string; note?: string; mediaUrl?: string }> {
    switch (c.type) {
      case "text":
        return { type: MessageType.TEXT, text: c.text?.body || undefined };
      case "image": {
        if (!c.image?.media_id || !c.conversation_id || !c.message_id) return { type: MessageType.IMAGE, note: "La imagen no se pudo descargar de TikTok." };
        try {
          const token = await this.client.validToken(account);
          const img = await this.client.downloadImage({ businessId: account.businessId, accessToken: token }, c.conversation_id, c.message_id, c.image.media_id);
          const stored = await this.storage.save(img.buffer, img.mimeType, `tiktok-${c.message_id}`);
          return { type: MessageType.IMAGE, mediaUrl: toStorageRef(stored.id) };
        } catch (e) {
          this.logger.warn(`No se pudo descargar la imagen ${c.message_id}: ${(e as Error).message}`);
          return { type: MessageType.IMAGE, note: "La imagen no se pudo descargar de TikTok." };
        }
      }
      case "sticker":
        return { type: MessageType.TEXT, note: "Envió un sticker." };
      case "share_post":
        return { type: MessageType.TEXT, note: `Compartió un video de TikTok${c.share_post?.embed_url ? `: ${c.share_post.embed_url}` : "."}` };
      default:
        return { type: MessageType.TEXT, note: `Mensaje no compatible (${c.type ?? "desconocido"}): míralo en la app de TikTok.` };
    }
  }
}
