/**
 * Avisos de Messenger e Instagram tal como llegan al webhook de Meta, y los
 * trabajos (ya limpios) que entran en la cola. Un `entry` trae `messaging[]`;
 * cada elemento es un hecho: un mensaje, un botón pulsado, un «leído», una
 * reacción… Messenger llega con `object: "page"` y Instagram con
 * `object: "instagram"`; en ambos `entry.id` es la cuenta que recibe.
 */
export type MetaPlatform = "messenger" | "instagram";

interface Base {
  platform: MetaPlatform;
  /** `entry.id`: el id de la página (Messenger) o de la cuenta de Instagram. */
  accountId: string;
  senderId: string;
  recipientId: string;
  timestampMs: number;
}

export interface SocialAttachment {
  type: string;
  url?: string;
  title?: string;
  stickerId?: string;
  lat?: number;
  long?: number;
}

/** Anuncio Click-to-Messenger / Click-to-Direct que trajo el mensaje. */
export interface SocialReferral {
  ref?: string;
  source?: string;
  adId?: string;
  adTitle?: string;
  photoUrl?: string;
  videoUrl?: string;
}

export interface SocialMessageJob extends Base {
  kind: "message";
  mid: string;
  text?: string;
  attachments: SocialAttachment[];
  quickReplyPayload?: string;
  replyToMid?: string;
  /** Instagram: respondió a una historia nuestra (URL del CDN, caduca). */
  storyUrl?: string;
  /** Lo mandó la propia página (desde otra herramienta, o es el eco de lo nuestro). */
  isEcho: boolean;
  isDeleted: boolean;
  isUnsupported: boolean;
  referral?: SocialReferral;
}

export interface SocialPostbackJob extends Base {
  kind: "postback";
  mid?: string;
  title: string;
  payload: string;
}

export interface SocialReadJob extends Base {
  kind: "read";
  /** Messenger: todo lo anterior a esta hora está leído. */
  watermarkMs?: number;
  /** Instagram: el mensaje leído. */
  mid?: string;
}

export interface SocialDeliveryJob extends Base {
  kind: "delivery";
  mids: string[];
  watermarkMs?: number;
}

export interface SocialReactionJob extends Base {
  kind: "reaction";
  mid: string;
  /** Vacío = quitó la reacción. */
  emoji: string;
}

export type MetaMessagingJob = SocialMessageJob | SocialPostbackJob | SocialReadJob | SocialDeliveryJob | SocialReactionJob;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MetaMessagingBody {
  object?: string;
  entry?: {
    id?: string | number;
    time?: number;
    messaging?: any[];
    /** Otra app lleva la conversación (Conversation Routing): se ignora. */
    standby?: any[];
  }[];
}

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Del cuerpo del webhook a trabajos. Lo que no se reconoce se descarta sin romper lo demás. */
export function normalizeMetaMessaging(body: MetaMessagingBody): MetaMessagingJob[] {
  const platform: MetaPlatform | null = body.object === "page" ? "messenger" : body.object === "instagram" ? "instagram" : null;
  if (!platform) return [];
  const jobs: MetaMessagingJob[] = [];
  for (const entry of body.entry ?? []) {
    const accountId = str(entry.id);
    if (!accountId) continue;
    for (const ev of entry.messaging ?? []) {
      const senderId = str(ev?.sender?.id);
      const recipientId = str(ev?.recipient?.id);
      if (!senderId || !recipientId) continue;
      const base: Base = { platform, accountId, senderId, recipientId, timestampMs: num(ev.timestamp) ?? Date.now() };

      if (ev.message) {
        const m = ev.message;
        const mid = str(m.mid);
        if (!mid) continue;
        const attachments: SocialAttachment[] = Array.isArray(m.attachments)
          ? m.attachments
              .map((a: any): SocialAttachment | null => {
                const type = str(a?.type);
                if (!type) return null;
                const p = a.payload ?? {};
                return {
                  type,
                  url: str(p.url),
                  title: str(p.title),
                  stickerId: str(p.sticker_id),
                  lat: num(p.coordinates?.lat),
                  long: num(p.coordinates?.long),
                };
              })
              .filter((a: SocialAttachment | null): a is SocialAttachment => !!a)
          : [];
        const r = m.referral;
        jobs.push({
          ...base,
          kind: "message",
          mid,
          text: typeof m.text === "string" && m.text.length ? m.text : undefined,
          attachments,
          quickReplyPayload: str(m.quick_reply?.payload),
          replyToMid: str(m.reply_to?.mid),
          storyUrl: str(m.reply_to?.story?.url),
          // Messenger marca los ecos; en Instagram el remitente es la propia cuenta.
          isEcho: m.is_echo === true || (platform === "instagram" && senderId === accountId),
          isDeleted: m.is_deleted === true,
          isUnsupported: m.is_unsupported === true,
          referral: r
            ? {
                ref: str(r.ref),
                source: str(r.source),
                adId: str(r.ad_id),
                adTitle: str(r.ads_context_data?.ad_title),
                photoUrl: str(r.ads_context_data?.photo_url),
                videoUrl: str(r.ads_context_data?.video_url),
              }
            : undefined,
        });
        continue;
      }
      if (ev.postback) {
        const payload = str(ev.postback.payload);
        const title = str(ev.postback.title);
        if (!payload && !title) continue;
        jobs.push({ ...base, kind: "postback", mid: str(ev.postback.mid), title: title ?? payload ?? "", payload: payload ?? title ?? "" });
        continue;
      }
      if (ev.read) {
        jobs.push({ ...base, kind: "read", watermarkMs: num(ev.read.watermark), mid: str(ev.read.mid) });
        continue;
      }
      if (ev.delivery) {
        const mids = Array.isArray(ev.delivery.mids) ? ev.delivery.mids.map(String) : [];
        jobs.push({ ...base, kind: "delivery", mids, watermarkMs: num(ev.delivery.watermark) });
        continue;
      }
      if (ev.reaction) {
        const mid = str(ev.reaction.mid);
        if (!mid) continue;
        const emoji = ev.reaction.action === "unreact" ? "" : (str(ev.reaction.emoji) ?? REACTION_EMOJI[str(ev.reaction.reaction) ?? ""] ?? "❤️");
        jobs.push({ ...base, kind: "reaction", mid, emoji });
        continue;
      }
      // messaging_referrals (enlace m.me / ig.me sin mensaje), optins, handovers…: nada que guardar.
    }
  }
  return jobs;
}

const REACTION_EMOJI: Record<string, string> = {
  love: "❤️",
  like: "👍",
  dislike: "👎",
  smile: "😆",
  angry: "😡",
  sad: "😢",
  wow: "😮",
};
