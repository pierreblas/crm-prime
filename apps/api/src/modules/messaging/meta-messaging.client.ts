import { Inject, Injectable, Logger } from "@nestjs/common";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import {
  STORAGE_PROVIDER,
  toStorageRef,
  type StorageProvider,
} from "../../infra/storage/storage.provider";

/**
 * Llamadas a la Graph API para Messenger e Instagram (Messenger Platform).
 *
 * Los dos canales cuelgan de la página de Facebook: se envía con el token de
 * página a `/{page-id}/messages`, y el destinatario es el id que Meta le da a
 * esa persona para la página (PSID) o para la cuenta de Instagram (IGSID).
 * Documentación: developers.facebook.com/documentation/business-messaging.
 */
export interface PageCreds {
  pageId: string;
  accessToken: string;
  platform: "messenger" | "instagram";
}

export type SocialMediaKind = "image" | "video" | "audio" | "file";

export interface QuickReply {
  title: string;
  payload: string;
}

export type GenericButton =
  | { type: "postback"; title: string; payload: string }
  | { type: "web_url"; title: string; url: string };

export interface GenericElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: GenericButton[];
}

export interface SocialSendOptions {
  /** mid del mensaje al que se responde (cita). */
  replyToMid?: string;
  /**
   * Fuera de las 24 h: etiqueta de agente humano, que Meta admite hasta 7 días
   * después del último mensaje del cliente y solo para respuestas de personas.
   */
  humanAgent?: boolean;
  quickReplies?: QuickReply[];
}

export interface SocialProfile {
  name: string | null;
  username: string | null;
  profilePic: string | null;
}

/** Error de Graph ya explicado: el texto de Meta más su código. */
export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
  }
}

const QUICK_REPLY_MAX = 13;
const QUICK_REPLY_TITLE_MAX = 20;
const GENERIC_TITLE_MAX = 80;
const DOWNLOAD_TIMEOUT_MS = 20_000;

@Injectable()
export class MetaMessagingClient {
  private readonly logger = new Logger("MetaMessaging");

  constructor(
    private readonly settings: IntegrationSettingsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private get baseUrl(): string {
    return process.env.META_GRAPH_URL ?? "https://graph.facebook.com";
  }

  private async version(): Promise<string> {
    const app = await this.settings.whatsappApp();
    return app.graphVersion || "v24.0";
  }

  // ── Enviar ───────────────────────────────────────────────────
  async sendText(page: PageCreds, to: string, text: string, opts: SocialSendOptions = {}): Promise<{ mid: string }> {
    const quick = (opts.quickReplies ?? []).slice(0, QUICK_REPLY_MAX).map((q) => ({
      content_type: "text",
      title: q.title.slice(0, QUICK_REPLY_TITLE_MAX),
      payload: q.payload.slice(0, 1000),
    }));
    return this.send(page, to, { text, ...(quick.length ? { quick_replies: quick } : {}) }, opts);
  }

  /** Un adjunto: por URL pública o por el id que devolvió `uploadMedia`. */
  async sendMedia(
    page: PageCreds,
    to: string,
    kind: SocialMediaKind,
    ref: { url: string } | { attachmentId: string },
    opts: SocialSendOptions = {},
  ): Promise<{ mid: string }> {
    const payload = "attachmentId" in ref ? { attachment_id: ref.attachmentId } : { url: ref.url, is_reusable: false };
    return this.send(page, to, { attachment: { type: kind, payload } }, opts);
  }

  /** Tarjetas con imagen, título y botones (hasta 10, en carrusel). */
  async sendGenericTemplate(page: PageCreds, to: string, elements: GenericElement[], opts: SocialSendOptions = {}): Promise<{ mid: string }> {
    const els = elements.slice(0, 10).map((e) => ({
      title: e.title.slice(0, GENERIC_TITLE_MAX) || "·",
      ...(e.subtitle ? { subtitle: e.subtitle.slice(0, GENERIC_TITLE_MAX) } : {}),
      ...(e.imageUrl ? { image_url: e.imageUrl } : {}),
      ...(e.buttons?.length
        ? {
            buttons: e.buttons.slice(0, 3).map((b) =>
              b.type === "web_url"
                ? { type: "web_url", title: b.title.slice(0, QUICK_REPLY_TITLE_MAX), url: b.url }
                : { type: "postback", title: b.title.slice(0, QUICK_REPLY_TITLE_MAX), payload: b.payload.slice(0, 1000) },
            ),
          }
        : {}),
    }));
    return this.send(page, to, { attachment: { type: "template", payload: { template_type: "generic", elements: els } } }, opts);
  }

  private async send(page: PageCreds, to: string, message: Record<string, unknown>, opts: SocialSendOptions): Promise<{ mid: string }> {
    const body: Record<string, unknown> = {
      recipient: { id: to },
      message,
      ...(opts.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" }),
      ...(opts.replyToMid ? { reply_to: { mid: opts.replyToMid } } : {}),
    };
    const data = await this.post<{ message_id?: string; recipient_id?: string }>(page, "messages", body);
    if (!data.message_id) throw new MetaGraphError("Meta no devolvió el id del mensaje", null, null);
    return { mid: data.message_id };
  }

  /** «Escribiendo…» o «visto». Solo con recipient y sender_action en el cuerpo. */
  async senderAction(page: PageCreds, to: string, action: "typing_on" | "typing_off" | "mark_seen"): Promise<void> {
    await this.post(page, "messages", { recipient: { id: to }, sender_action: action });
  }

  /** Reacción a un mensaje del cliente; emoji null la quita. Instagram solo admite «love». */
  async react(page: PageCreds, to: string, mid: string, emoji: string | null): Promise<void> {
    await this.post(page, "messages", {
      recipient: { id: to },
      sender_action: emoji ? "react" : "unreact",
      payload: { message_id: mid, ...(emoji ? { reaction: page.platform === "instagram" ? "love" : emoji } : {}) },
    });
  }

  /**
   * Sube un archivo nuestro y devuelve su attachment_id. Hace falta porque los
   * archivos del CRM no son públicos y Meta, si no, exige una URL.
   */
  async uploadMedia(page: PageCreds, kind: SocialMediaKind, buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    const version = await this.version();
    const form = new FormData();
    form.append("message", JSON.stringify({ attachment: { type: kind, payload: { is_reusable: true } } }));
    if (page.platform === "instagram") form.append("platform", "instagram");
    // Meta rechaza nombres con caracteres fuera de ASCII.
    const safeName = filename.replace(/[^\x20-\x7e]/g, "_") || "archivo";
    form.append("filedata", new Blob([new Uint8Array(buffer)], { type: mimeType }), safeName);
    const res = await fetch(
      `${this.baseUrl}/${version}/${page.pageId}/message_attachments?access_token=${encodeURIComponent(page.accessToken)}`,
      { method: "POST", body: form },
    );
    const data = await this.read<{ attachment_id?: string }>(res, "subir el archivo a Meta");
    if (!data.attachment_id) throw new MetaGraphError("Meta no devolvió el id del archivo", null, null);
    return data.attachment_id;
  }

  // ── Leer ─────────────────────────────────────────────────────
  /**
   * Nombre y foto de quien escribe. Messenger: nombre y apellido (exige el
   * acceso avanzado «Business Asset User Profile Access»); Instagram: nombre y
   * usuario. Si Meta no lo da, null: el contacto se queda con su identificador.
   */
  async profile(page: PageCreds, userId: string): Promise<SocialProfile | null> {
    const version = await this.version();
    const fields = page.platform === "instagram" ? "name,username,profile_pic" : "first_name,last_name,name,profile_pic";
    const res = await fetch(`${this.baseUrl}/${version}/${userId}?fields=${fields}&access_token=${encodeURIComponent(page.accessToken)}`);
    const data = (await res.json().catch(() => null)) as
      | { name?: string; first_name?: string; last_name?: string; username?: string; profile_pic?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !data || data.error) {
      this.logger.debug(`Sin perfil de ${userId}: ${data?.error?.message ?? `HTTP ${res.status}`}`);
      return null;
    }
    const name = (data.name ?? [data.first_name, data.last_name].filter(Boolean).join(" ")).trim();
    return { name: name || null, username: data.username ?? null, profilePic: data.profile_pic ?? null };
  }

  /**
   * Descarga un adjunto entrante (URL del CDN de Meta, pública pero caduca) al
   * almacén propio: lo que se guarda es nuestra copia, no el enlace.
   */
  async download(url: string, hint: string): Promise<{ url: string; mimeType: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`descarga ${res.status}`);
      const mimeType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
      const buffer = Buffer.from(await res.arrayBuffer());
      const stored = await this.storage.save(buffer, mimeType, hint);
      return { url: toStorageRef(stored.id), mimeType: stored.mimeType };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Transporte ───────────────────────────────────────────────
  private async post<T>(page: PageCreds, edge: string, body: Record<string, unknown>): Promise<T> {
    const version = await this.version();
    const res = await fetch(`${this.baseUrl}/${version}/${page.pageId}/${edge}?access_token=${encodeURIComponent(page.accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.read<T>(res, "enviar por " + (page.platform === "instagram" ? "Instagram" : "Messenger"));
  }

  private async read<T>(res: Response, what: string): Promise<T> {
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } })
      | null;
    if (!res.ok || !data || data.error) {
      const e = data?.error;
      const msg = explainMetaError(e?.code ?? null, e?.error_subcode ?? null, e?.error_user_msg ?? e?.message ?? `HTTP ${res.status}`);
      this.logger.warn(`No se pudo ${what}: ${msg}`);
      throw new MetaGraphError(msg, e?.code ?? null, e?.error_subcode ?? null);
    }
    return data;
  }
}

/** Los errores de Meta que un vendedor puede arreglar o entender, en su idioma. */
export function explainMetaError(code: number | null, subcode: number | null, raw: string): string {
  if (code === 190) return "El acceso a la página caducó o se revocó: vuelve a conectar con Facebook en Ajustes › Canales.";
  if (code === 10 && /window|24/i.test(raw)) {
    return "Pasó la ventana de 24 h y Meta no aceptó la respuesta como agente humano (esa etiqueta necesita aprobación de Meta).";
  }
  if (code === 10) return "La app no tiene permiso para enviar mensajes por esta página (pages_messaging / instagram_manage_messages).";
  if (code === 551 || subcode === 1545041) return "Esta persona no está disponible ahora (bloqueó la página o borró la conversación).";
  if (code === 613 || code === 4) return "Meta limitó el ritmo de envío; se reintentará.";
  if (code === 100 && /tag/i.test(raw)) return "Meta rechazó la etiqueta de agente humano: la app necesita el permiso «Human Agent».";
  return raw;
}
