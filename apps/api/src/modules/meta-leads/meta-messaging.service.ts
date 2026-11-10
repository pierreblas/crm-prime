import { Injectable, Logger } from "@nestjs/common";
import { MessageType, socialId } from "@crm/shared";
import type { MetaPage } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { MessagingService, type SocialChannelRef } from "../messaging/messaging.service";
import { MetaMessagingClient, type PageCreds } from "../messaging/meta-messaging.client";
import type { MetaReferral } from "../whatsapp/webhook.types";
import type { MetaMessagingJob, SocialAttachment, SocialMessageJob } from "./meta-messaging.types";

/**
 * Lo que pasa con cada aviso de Messenger o Instagram una vez resuelta la
 * empresa (ver MetaMessagingProcessor). Traduce lo que manda Meta a lo que
 * entiende la bandeja (MessagingService), que es la misma para WhatsApp:
 * contacto, conversación, mensaje, y de ahí flujos, agente y avisos.
 */
@Injectable()
export class MetaMessagingService {
  private readonly logger = new Logger("MetaMessaging");

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly client: MetaMessagingClient,
  ) {}

  async dispatch(job: MetaMessagingJob, page: MetaPage): Promise<void> {
    const creds: PageCreds = { pageId: page.pageId, accessToken: page.accessToken, platform: job.platform };
    const social: SocialChannelRef = {
      kind: job.platform,
      metaPageId: page.id,
      since: page.messagingSubscribedAt,
      label: job.platform === "instagram" ? `@${page.instagramUsername ?? page.name}` : page.name,
      pipelineId: job.platform === "instagram" ? page.instagramPipelineId : page.messengerPipelineId,
      sourceId: job.platform === "instagram" ? page.instagramSourceId : page.messengerSourceId,
    };

    switch (job.kind) {
      case "message":
        return job.isEcho ? this.echo(job, social) : this.message(job, social, creds);
      case "postback":
        return this.messaging.handleInbound({
          from: socialId(job.platform, job.senderId),
          waMessageId: job.mid ?? `pb.${job.platform}.${job.senderId}.${job.timestampMs}`,
          type: MessageType.TEXT,
          text: job.title,
          buttonPayload: job.payload,
          timestampMs: job.timestampMs,
          social,
        });
      case "read":
        return this.messaging.markReadUpTo(socialId(job.platform, job.senderId), job.watermarkMs ?? job.timestampMs, job.mid);
      case "delivery":
        return this.messaging.markDeliveredUpTo(socialId(job.platform, job.senderId), job.mids, job.watermarkMs);
      case "reaction":
        return this.messaging.handleReaction(job.mid, job.emoji);
    }
  }

  // ── Mensaje del cliente ──────────────────────────────────────
  private async message(job: SocialMessageJob, social: SocialChannelRef, creds: PageCreds): Promise<void> {
    if (job.isDeleted) return this.messaging.markDeletedByContact(job.mid);
    const from = socialId(job.platform, job.senderId);

    // Nombre y usuario solo la primera vez (o si aún no los tenemos): es una
    // llamada a Meta por mensaje que no hace falta repetir.
    const known = await this.prisma.contact.findFirst({ where: { phone: from }, select: { name: true } });
    const profile = known?.name ? null : await this.client.profile(creds, job.senderId).catch(() => null);

    const content = await this.content(job);
    await this.messaging.handleInbound({
      from,
      name: profile?.name ?? undefined,
      username: job.platform === "instagram" ? (profile?.username ?? undefined) : undefined,
      waMessageId: job.mid,
      type: content.type,
      text: content.text,
      note: content.note,
      mediaUrl: content.mediaUrl,
      buttonPayload: job.quickReplyPayload,
      replyToWaMessageId: job.replyToMid,
      referral: toMetaReferral(job),
      timestampMs: job.timestampMs,
      social,
    });
  }

  /** Lo que mandó la propia página desde otra herramienta (o el eco de lo nuestro, que se ignora por el mid). */
  private async echo(job: SocialMessageJob, social: SocialChannelRef): Promise<void> {
    const content = await this.content(job);
    await this.messaging.handleSocialEcho({
      social,
      to: socialId(job.platform, job.recipientId),
      mid: job.mid,
      type: content.type,
      text: content.text,
      note: content.note,
      mediaUrl: content.mediaUrl,
    });
  }

  /**
   * Tipo, texto, medio y nota de un mensaje. Un adjunto se descarga al almacén
   * (la URL del CDN caduca); lo que no es un archivo (una publicación
   * compartida, una mención en una historia…) se explica en `note`, que nunca
   * se confunde con lo que escribió el cliente.
   */
  private async content(job: SocialMessageJob): Promise<{ type: MessageType; text?: string; note?: string; mediaUrl?: string }> {
    const notes: string[] = [];
    if (job.isUnsupported) {
      notes.push(`Mensaje no compatible: míralo en la app de ${job.platform === "instagram" ? "Instagram" : "Messenger"}.`);
    }
    if (job.storyUrl) notes.push(`Respondió a tu historia: ${job.storyUrl}`);

    let type: MessageType = MessageType.TEXT;
    let mediaUrl: string | undefined;
    const [first, ...rest] = job.attachments;
    if (first) {
      const media = mediaKind(first);
      if (media) {
        type = media;
        if (first.url) {
          mediaUrl = await this.client
            .download(first.url, `${job.platform}-${job.mid}`)
            .then((d) => d.url)
            .catch((e: Error) => {
              this.logger.warn(`No se pudo descargar el adjunto de ${job.mid}: ${e.message}`);
              notes.push("El archivo no se pudo descargar de Meta.");
              return undefined;
            });
        }
      } else if (first.type === "location" && first.lat !== undefined && first.long !== undefined) {
        type = MessageType.LOCATION;
        notes.push(`Ubicación: https://maps.google.com/?q=${first.lat},${first.long}`);
      } else {
        notes.push(describe(first));
      }
      if (rest.length) notes.push(`Y ${rest.length} adjunto${rest.length === 1 ? "" : "s"} más: míralos en la app.`);
    }
    return {
      type,
      text: job.text,
      note: notes.length ? notes.join(" ").slice(0, 1500) : undefined,
      mediaUrl,
    };
  }
}

/** Qué tipo de medio de la bandeja es un adjunto, o null si no es un archivo. */
function mediaKind(a: SocialAttachment): MessageType | null {
  switch (a.type) {
    case "image":
      return a.stickerId ? MessageType.STICKER : MessageType.IMAGE;
    case "sticker":
      return MessageType.STICKER;
    case "video":
      return MessageType.VIDEO;
    case "audio":
      return MessageType.AUDIO;
    case "file":
      return MessageType.DOCUMENT;
    default:
      return null;
  }
}

function describe(a: SocialAttachment): string {
  const where = a.url ? `: ${a.url}` : "";
  switch (a.type) {
    case "story_mention":
      return `Te mencionó en una historia${where}`;
    case "share":
    case "post":
    case "ig_post":
      return `Compartió una publicación${a.title ? ` («${a.title}»)` : ""}${where}`;
    case "reel":
    case "ig_reel":
      return `Compartió un reel${a.title ? ` («${a.title}»)` : ""}${where}`;
    case "fallback":
      return `Compartió un enlace${a.title ? `: ${a.title}` : ""}${where}`;
    case "ephemeral":
      return "Envió una foto o un video que desaparece: míralo en la app.";
    case "template":
      return "Envió un mensaje con tarjeta (plantilla).";
    default:
      return `Envió un adjunto que no se puede mostrar aquí (${a.type}).`;
  }
}

/** El anuncio que trajo el mensaje, en la forma que ya entiende la bandeja (la de WhatsApp). */
function toMetaReferral(job: SocialMessageJob): MetaReferral | undefined {
  const r = job.referral;
  if (!r?.adId && !r?.ref) return undefined;
  return {
    source_id: r.adId,
    source_type: r.adId ? "ad" : undefined,
    headline: r.adTitle,
    image_url: r.photoUrl,
    video_url: r.videoUrl,
    ref: r.ref,
  };
}
