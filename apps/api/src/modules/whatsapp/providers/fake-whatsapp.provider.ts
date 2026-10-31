import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  DownloadedMedia,
  InteractiveButton,
  SendResult,
  TemplateSendSpec,
  WhatsAppProvider,
  OutboundMediaKind,
} from "../whatsapp-provider.interface";

/**
 * Proveedor simulado para desarrollo sin credenciales de Meta.
 * No envía nada real: registra en log y devuelve un wa_message_id sintético.
 */
@Injectable()
export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly name = "fake";
  private readonly logger = new Logger("FakeWhatsApp");

  async sendText(
    to: string,
    text: string,
    _fromPhoneNumberId?: string,
    _replyToWaMessageId?: string,
  ): Promise<SendResult> {
    const waMessageId = `wamid.fake.${randomUUID()}`;
    this.logger.log(`→ [text] a ${to}: "${text}"  (${waMessageId})`);
    return { waMessageId };
  }

  async sendMedia(
    to: string,
    kind: OutboundMediaKind,
    mediaUrl: string,
    caption?: string,
  ): Promise<SendResult> {
    const waMessageId = `wamid.fake.${randomUUID()}`;
    this.logger.log(
      `→ [${kind}] a ${to}: ${mediaUrl}${caption ? ` "${caption}"` : ""}  (${waMessageId})`,
    );
    return { waMessageId };
  }

  async sendTemplate(to: string, spec: TemplateSendSpec): Promise<SendResult> {
    const waMessageId = `wamid.fake.${randomUUID()}`;
    const extras = [
      spec.header ? `header:${spec.header.format}` : null,
      spec.buttons.length ? `botones:${spec.buttons.length}` : null,
    ].filter(Boolean);
    this.logger.log(
      `→ [template:${spec.name}/${spec.language}] a ${to} vars=[${spec.bodyParams.join(", ")}]` +
        `${extras.length ? ` (${extras.join(", ")})` : ""}  (${waMessageId})`,
    );
    return { waMessageId };
  }

  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: InteractiveButton[],
  ): Promise<SendResult> {
    const waMessageId = `wamid.fake.${randomUUID()}`;
    this.logger.log(
      `→ [interactive] a ${to}: "${body}" [${buttons.map((b) => b.title).join(" | ")}]  (${waMessageId})`,
    );
    return { waMessageId };
  }

  async sendInteractive(to: string, interactive: Record<string, unknown>): Promise<SendResult> {
    const waMessageId = `wamid.fake.${randomUUID()}`;
    this.logger.log(`→ [interactive:${String(interactive.type)}] a ${to}  (${waMessageId})`);
    return { waMessageId };
  }

  async sendReaction(
    to: string,
    targetWaMessageId: string,
    emoji: string,
  ): Promise<SendResult> {
    const waMessageId = `wamid.fake.${randomUUID()}`;
    this.logger.log(
      `→ [reaction:${emoji || "✕"}] a ${to} sobre ${targetWaMessageId}  (${waMessageId})`,
    );
    return { waMessageId };
  }

  async uploadMedia(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const id = `fake-media-${Date.now()}`;
    this.logger.log(
      `[simulado] subido ${filename} (${mimeType}, ${buffer.byteLength} bytes) -> ${id}`,
    );
    return id;
  }

  async sendMediaById(
    to: string,
    kind: OutboundMediaKind,
    mediaId: string,
    caption?: string,
  ): Promise<SendResult> {
    this.logger.log(`[simulado] ${kind} ${mediaId} -> ${to} ${caption ?? ""}`);
    return { waMessageId: `wamid.fake.${Date.now()}` };
  }

  async sendTypingIndicator(waMessageId: string): Promise<void> {
    this.logger.log(`[simulado] escribiendo… (sobre ${waMessageId})`);
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    this.logger.log(`↓ media simulada ${mediaId}`);
    return {
      url: `https://example.invalid/media/${mediaId}`,
      mimeType: "application/octet-stream",
    };
  }
}
