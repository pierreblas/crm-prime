import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { ConversationsQuery, UnreadCount } from "@crm/shared";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Queue } from "bullmq";
import {
  MessageAuthor,
  MessageDirection,
  MessageStatus,
  MessageType,
  adReferralLabel,
  parseUtms,
  utmsFromUrl,
  type AdReferral,
  type Utms,
  type AiMode,
  type ConversationDto,
  type ConversationStatus,
  type MessageDto,
  type NoteDto,
  type SendInteractiveInput,
  type SendMessageInput,
  type SendTemplateMessageInput,
  type TemplateButton,
  type TemplateHeader,
  FILTER_NONE,
} from "@crm/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { QUEUE_OUTBOUND } from "../../infra/queue/queue.constants";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "../whatsapp/whatsapp-provider.interface";
import { WhatsappConnectionService } from "../whatsapp/whatsapp-connection.service";
import { WebhookOutService } from "../webhooks-out/webhook-out.service";
import {
  STORAGE_PROVIDER,
  parseStorageRef,
  type StorageProvider,
} from "../../infra/storage/storage.provider";
import type { MetaReferral } from "../whatsapp/webhook.types";
import { TemplateFillService } from "../campaigns/template-fill.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { i18n } from "../../i18n/i18n";

// Aplana el payload de Meta a nuestra forma, en camelCase y con nulls
// explícitos, para guardarlo en Conversation.referral.
function toAdReferral(r: MetaReferral): AdReferral {
  return {
    sourceUrl: r.source_url ?? null,
    sourceId: r.source_id ?? null,
    sourceType: r.source_type ?? null,
    headline: r.headline ?? null,
    body: r.body ?? null,
    mediaType: r.media_type ?? null,
    imageUrl: r.image_url ?? null,
    videoUrl: r.video_url ?? null,
    thumbnailUrl: r.thumbnail_url ?? null,
    ctwaClid: r.ctwa_clid ?? null,
    welcomeMessage: r.welcome_message?.text ?? null,
  };
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const OPT_OUT_KEYWORDS = ["BAJA", "STOP", "CANCELAR"];

export interface InboundMessage {
  from: string; // teléfono E.164
  name?: string;
  waMessageId: string;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  channelPhoneNumberId?: string; // número que recibió el mensaje (multi-número)
  // Anuncio Click-to-WhatsApp que abrió la conversación (primer mensaje).
  referral?: MetaReferral;
  /** waMessageId que el cliente citó al responder. */
  replyToWaMessageId?: string;
  /** Identificador del botón pulsado (plantilla o mensaje interactivo). */
  buttonPayload?: string;
}

/** Cómo se anuncia un mensaje sin texto en un aviso. */
const PREVIEW_LABEL: Record<string, string> = {
  IMAGE: "📷 Imagen",
  AUDIO: "🎤 Audio",
  VIDEO: "🎥 Video",
  STICKER: "Sticker",
  DOCUMENT: "📄 Documento",
  LOCATION: "📍 Ubicación",
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger("Messaging");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    @InjectQueue(QUEUE_OUTBOUND) private readonly outbound: Queue,
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsAppProvider,
    private readonly connection: WhatsappConnectionService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly events: EventEmitter2,
    private readonly webhooks: WebhookOutService,
    private readonly fills: TemplateFillService,
    private readonly pipeline: PipelineService,
  ) {}

  /** Un mensaje nuestro salió: los flujos «el cliente no responde» cuentan desde aquí. */
  private outboundSent(orgId: string, conversationId: string, messageId: string, author: string): void {
    this.events.emit("message.outbound", { orgId, conversationId, messageId, author });
  }

  private notify(conversationId: string, extra: Record<string, unknown> = {}): void {
    this.events.emit("inbox.changed", {
      conversationId,
      orgId: currentOrgId() ?? undefined,
      ...extra,
    });
  }

  // Pausa la IA tras intervención humana (ventana configurable).
  private readonly humanPauseMs = 15 * 60 * 1000;

  // Fusiona los utm_* en metadata SIN pisar los que ya tuviera: interesa la
  // campaña que trajo al contacto la primera vez.
  private async mergeUtms(contactId: string, utms: Utms): Promise<void> {
    const current = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { metadata: true },
    });
    const metadata = {
      ...((current?.metadata as Record<string, unknown> | null) ?? {}),
    };
    let changed = false;
    for (const [key, value] of Object.entries(utms)) {
      if (metadata[key] === undefined || metadata[key] === "") {
        metadata[key] = value;
        changed = true;
      }
    }
    if (!changed) return;
    await this.prisma.contact.update({
      where: { id: contactId },
      data: { metadata: metadata as Prisma.InputJsonObject },
    });
  }

  // ── Entrante: persistir (idempotente) + ventana 24h + opt-out ──
  async handleInbound(msg: InboundMessage): Promise<void> {
    // Idempotencia: si ya procesamos este wa_message_id, ignorar.
    const existing = await this.prisma.message.findUnique({
      where: { waMessageId: msg.waMessageId },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(`Duplicado ignorado: ${msg.waMessageId}`);
      return;
    }

    // Primero el canal: el `phone_number_id` que trae Meta es lo único que
    // dice de qué organización es este mensaje. De él cuelga todo lo demás.
    const channel = msg.channelPhoneNumberId
      ? await this.connection.resolveChannel(msg.channelPhoneNumberId)
      : null;
    const channelId = channel?.id ?? null;
    const orgId = channel?.orgId ?? this.tenant.orgId();

    const now = new Date();

    // ── Atribución de marketing ────────────────────────────────
    // Los utm_* pueden venir por dos vías: los "parámetros de URL" del
    // anuncio (acaban en referral.source_url) y el texto prellenado de un
    // enlace wa.me. Los del anuncio mandan sobre los del texto.
    const referral = msg.referral ? toAdReferral(msg.referral) : null;
    const fromText = parseUtms(msg.text);
    const utms = { ...fromText.utms, ...utmsFromUrl(referral?.sourceUrl) };
    const hasUtms = Object.keys(utms).length > 0;
    // El texto se guarda limpio: el agente no debería ver los parámetros.
    const text = fromText.cleanText || msg.text;

    const optOut =
      !!text && OPT_OUT_KEYWORDS.includes(text.trim().toUpperCase());

    // Fuente automática: "WhatsApp", o "Anuncio de Meta" si trae referral.
    // Las fuentes son de la empresa (Ajustes › Fuentes), pero un contacto que
    // entra por WhatsApp tiene que decir de dónde vino sin que nadie lo
    // etiquete a mano.
    const sourceId = await fuenteAutomatica(
      this.prisma,
      orgId,
      referral ? "ad" : "whatsapp",
    );

    const contact = await this.prisma.contact.upsert({
      where: { orgId_phone: { orgId, phone: msg.from } },
      create: {
        orgId,
        phone: msg.from,
        name: msg.name,
        lastMessageAt: now,
        optIn: !optOut,
        // El origen solo se fija al crear: si el contacto ya existía,
        // conserva la vía por la que entró originalmente.
        origin: referral ? "ad" : "whatsapp",
        originDetail: referral
          ? adReferralLabel(referral)
          : (msg.channelPhoneNumberId ?? null),
        sourceId,
        ...(hasUtms ? { metadata: utms as Prisma.InputJsonObject } : {}),
      },
      update: {
        lastMessageAt: now,
        ...(msg.name ? { name: msg.name } : {}),
        ...(optOut ? { optIn: false } : {}),
      },
    });

    // Contacto anterior a la fuente automática: se le pone ahora, solo si no
    // tiene ninguna y entró por WhatsApp. Una fuente puesta a mano se respeta.
    if (
      !contact.sourceId &&
      (contact.origin === "whatsapp" || contact.origin === "ad")
    ) {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: { sourceId },
      });
    }

    // Contacto ya existente: fusionar los utm_* nuevos sin pisar los previos
    // (interesa la PRIMERA campaña que lo trajo, no la última).
    if (hasUtms) await this.mergeUtms(contact.id, utms);

    // Reusar conversación abierta o crear una nueva. La ventana de 24h se
    // renueva con cada mensaje entrante del contacto.
    const open = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" },
    });
    const windowExpiresAt = new Date(now.getTime() + WINDOW_MS);
    const isNewConversation = !open;
    // Tras cerrar, el siguiente mensaje abre otra conversación: hereda el modo
    // de la IA de la anterior (si estaba en Autopilot, sigue en Autopilot).
    const previous = open
      ? null
      : await this.prisma.conversation.findFirst({
          where: { contactId: contact.id },
          orderBy: { createdAt: "desc" },
          select: { aiMode: true },
        });
    const conversation = open
      ? await this.prisma.conversation.update({
          where: { id: open.id },
          data: {
            windowExpiresAt,
            lastMessageAt: now,
            status: "OPEN",
            awaitingReply: true, // el contacto escribió: queda pendiente de responder
            unreadCount: { increment: 1 },
            // Fija el canal si aún no lo tenía (conversaciones previas).
            ...(channelId && !open.channelId ? { channelId } : {}),
          },
        })
      : await this.prisma.conversation.create({
          data: {
            orgId,
            contactId: contact.id,
            channelId,
            status: "OPEN",
            windowExpiresAt,
            lastMessageAt: now,
            awaitingReply: true,
            unreadCount: 1,
            ...(previous ? { aiMode: previous.aiMode } : {}),
            // Qué anuncio abrió esta conversación (null si no vino de uno).
            ...(referral
              ? { referral: referral as unknown as Prisma.InputJsonObject }
              : {}),
          },
        });

    // Entrada al embudo: si la empresa activó la regla y el contacto no tiene
    // una oportunidad en curso, aparece en "Entrantes" sin que nadie la cree,
    // y la conversación queda asignada al mismo vendedor.
    await this.pipeline
      .intakeFromWhatsapp(contact.id, channelId, conversation.id)
      .catch((e: Error) => this.logger.warn(`Entrada al embudo falló: ${e.message}`));

    // La cita llega como waMessageId de Meta: se traduce al id nuestro.
    const quoted = msg.replyToWaMessageId
      ? await this.prisma.message.findUnique({
          where: { waMessageId: msg.replyToWaMessageId },
          select: { id: true },
        })
      : null;

    await this.prisma.message.create({
      data: {
        orgId,
        conversationId: conversation.id,
        waMessageId: msg.waMessageId,
        replyToId: quoted?.id ?? null,
        direction: MessageDirection.INBOUND,
        type: msg.type,
        author: MessageAuthor.CONTACT,
        content: text,
        mediaUrl: msg.mediaUrl,
        buttonPayload: msg.buttonPayload ?? null,
        status: MessageStatus.DELIVERED,
      },
    });

    this.logger.log(
      `← ${msg.from}: "${text ?? msg.type}"${optOut ? " [OPT-OUT]" : ""}`,
    );

    // Aviso a sistemas externos. Sin await: un webhook lento no puede
    // retrasar el procesado del mensaje.
    void this.webhooks.emit("message.received", {
      contact: { id: contact.id, phone: contact.phone, name: contact.name },
      conversationId: conversation.id,
      message: { type: msg.type, text: text ?? null },
      isNewConversation,
    });
    // Con quién y qué dijo: la app avisa esté donde esté la persona.
    this.notify(conversation.id, {
      inbound: {
        contactName: contact.name ?? contact.phone,
        preview: (text ?? PREVIEW_LABEL[msg.type] ?? msg.type.toLowerCase()).slice(0, 120),
      },
    });
    // Conversación nueva: dispara la automatización de bienvenida / autopilot
    // por defecto (AutomationService) antes del flujo normal de entrante.
    if (isNewConversation) {
      this.events.emit("conversation.created", {
        conversationId: conversation.id,
      });
    }
    // Disparar la automatización de IA (palabras clave, horario, autopilot).
    // Lo maneja AutomationService de forma asíncrona con sus guardrails.
    this.events.emit("conversation.inbound", { conversationId: conversation.id });
  }

  // ── Coexistencia: mensaje enviado desde la app del celular ─────
  // Se registra como saliente (autor humano) y se pausa la IA, porque un
  // humano está respondiendo desde el teléfono.
  async handleEcho(echo: {
    to: string;
    waMessageId: string;
    type: MessageType;
    text?: string;
    channelPhoneNumberId?: string;
  }): Promise<void> {
    const existing = await this.prisma.message.findUnique({
      where: { waMessageId: echo.waMessageId },
      select: { id: true },
    });
    if (existing) return; // idempotencia

    // Primero el canal: el `phone_number_id` que trae Meta es lo único que
    // dice de qué organización es este mensaje. De él cuelga todo lo demás.
    const channel = echo.channelPhoneNumberId
      ? await this.connection.resolveChannel(echo.channelPhoneNumberId)
      : null;
    const channelId = channel?.id ?? null;
    const orgId = channel?.orgId ?? this.tenant.orgId();

    const now = new Date();
    const contact = await this.prisma.contact.upsert({
      where: { orgId_phone: { orgId, phone: echo.to } },
      create: {
        orgId,
        phone: echo.to,
        lastMessageAt: now,
        origin: "whatsapp",
        originDetail: echo.channelPhoneNumberId ?? null,
        sourceId: await fuenteAutomatica(this.prisma, orgId, "whatsapp"),
      },
      update: { lastMessageAt: now },
    });

    const open = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" },
    });
    const conversation = open
      ? await this.prisma.conversation.update({
          where: { id: open.id },
          data: {
            lastMessageAt: now,
            awaitingReply: false, // contestamos desde el celular
            // Un humano contestó desde el celular → pausar la IA.
            aiPausedUntil: new Date(now.getTime() + this.humanPauseMs),
            ...(channelId && !open.channelId ? { channelId } : {}),
          },
        })
      : await this.prisma.conversation.create({
          data: {
            orgId,
            contactId: contact.id,
            channelId,
            status: "OPEN",
            lastMessageAt: now,
            awaitingReply: false,
            aiPausedUntil: new Date(now.getTime() + this.humanPauseMs),
          },
        });

    const echoMsg = await this.prisma.message.create({
      data: {
        orgId,
        conversationId: conversation.id,
        waMessageId: echo.waMessageId,
        direction: MessageDirection.OUTBOUND,
        type: echo.type,
        author: MessageAuthor.HUMAN,
        content: echo.text,
        status: MessageStatus.SENT,
      },
    });

    this.outboundSent(orgId, conversation.id, echoMsg.id, MessageAuthor.HUMAN);
    this.logger.log(`→ (desde celular) ${echo.to}: "${echo.text ?? echo.type}"`);
    this.notify(conversation.id);
  }

  // ── Reacción entrante (emoji sobre un mensaje) ─────────────────
  async handleReaction(targetWaMessageId: string, emoji: string): Promise<void> {
    const msg = await this.prisma.message.findUnique({
      where: { waMessageId: targetWaMessageId },
      select: { id: true, conversationId: true },
    });
    if (!msg) return;
    await this.prisma.message.update({
      where: { id: msg.id },
      data: { reaction: emoji || null },
    });
    this.notify(msg.conversationId);
  }

  // ── Reaccionar a un mensaje desde el CRM (enviar a WhatsApp) ───
  async reactToMessage(messageId: string, emoji: string): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { contact: true, channel: true } } },
    });
    if (!message) throw new NotFoundException("Mensaje no encontrado");
    if (message.waMessageId) {
      await this.wa.sendReaction(
        message.conversation.contact.phone,
        message.waMessageId,
        emoji,
        message.conversation.channel?.phoneNumberId,
      );
    }
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { reaction: emoji || null },
    });
    this.notify(message.conversationId);
    return this.toMessageDto(updated);
  }

  // ── Coexistencia: importar un mensaje del historial ────────────
  async handleHistory(job: {
    customerWaId: string;
    fromCustomer: boolean;
    waMessageId: string;
    type: MessageType;
    text?: string;
    timestampMs: number;
    channelPhoneNumberId?: string;
  }): Promise<void> {
    const existing = await this.prisma.message.findUnique({
      where: { waMessageId: job.waMessageId },
      select: { id: true },
    });
    if (existing) return; // idempotencia

    // Primero el canal: el `phone_number_id` que trae Meta es lo único que
    // dice de qué organización es este mensaje. De él cuelga todo lo demás.
    const channel = job.channelPhoneNumberId
      ? await this.connection.resolveChannel(job.channelPhoneNumberId)
      : null;
    const channelId = channel?.id ?? null;
    const orgId = channel?.orgId ?? this.tenant.orgId();

    const when = new Date(job.timestampMs);
    const contact = await this.prisma.contact.upsert({
      where: { orgId_phone: { orgId, phone: job.customerWaId } },
      create: {
        orgId,
        phone: job.customerWaId,
        lastMessageAt: when,
        origin: "whatsapp",
        originDetail: job.channelPhoneNumberId ?? null,
        sourceId: await fuenteAutomatica(this.prisma, orgId, "whatsapp"),
      },
      update: {},
    });

    let conversation = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: "desc" },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          orgId,
          contactId: contact.id,
          channelId,
          status: "CLOSED", // historial: no abre una conversación activa
          lastMessageAt: when,
        },
      });
    }

    await this.prisma.message.create({
      data: {
        orgId,
        conversationId: conversation.id,
        waMessageId: job.waMessageId,
        direction: job.fromCustomer
          ? MessageDirection.INBOUND
          : MessageDirection.OUTBOUND,
        type: job.type,
        author: job.fromCustomer ? MessageAuthor.CONTACT : MessageAuthor.HUMAN,
        content: job.text,
        status: MessageStatus.DELIVERED,
        createdAt: when, // conserva el orden histórico
      },
    });
    // Importación silenciosa: no dispara IA ni automatización.
  }

  // ── Coexistencia: sincronizar contactos y etiquetas ───────────
  async handleStateSync(
    items: {
      kind: "contact" | "label" | "association";
      action: "add" | "remove";
      phone?: string;
      name?: string;
      labelId?: string;
      labelName?: string;
      labelColor?: string;
    }[],
  ): Promise<void> {
    const orgId = this.tenant.orgId();
    for (const it of items) {
      try {
        if (it.kind === "contact" && it.phone) {
          await this.prisma.contact.upsert({
            where: { orgId_phone: { orgId, phone: it.phone } },
            create: {
              orgId,
              phone: it.phone,
              name: it.name,
              origin: "import",
              originDetail: "Sincronización de WhatsApp",
              sourceId: await fuenteAutomatica(this.prisma, orgId, "whatsapp"),
            },
            update: it.name ? { name: it.name } : {},
          });
        } else if (it.kind === "label" && it.labelId) {
          await this.prisma.tag.upsert({
            where: { orgId_waLabelId: { orgId, waLabelId: it.labelId } },
            create: {
              orgId,
              waLabelId: it.labelId,
              name: it.labelName ?? it.labelId,
              color: it.labelColor,
            },
            update: it.labelName ? { name: it.labelName } : {},
          });
        } else if (it.kind === "association" && it.phone && it.labelId) {
          const [contact, tag] = await Promise.all([
            this.prisma.contact.findFirst({ where: { phone: it.phone } }),
            this.prisma.tag.findFirst({ where: { waLabelId: it.labelId } }),
          ]);
          if (contact && tag) {
            if (it.action === "remove") {
              await this.prisma.contactTag
                .delete({
                  where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
                })
                .catch(() => undefined);
            } else {
              await this.prisma.contactTag
                .create({ data: { contactId: contact.id, tagId: tag.id } })
                .catch(() => undefined);
            }
          }
        }
      } catch (e) {
        this.logger.warn(`State sync item falló: ${(e as Error).message}`);
      }
    }
  }

  // ── Actualización de estado (sent/delivered/read/failed) ───────
  async handleStatus(waMessageId: string, status: MessageStatus): Promise<void> {
    const msg = await this.prisma.message.findUnique({
      where: { waMessageId },
      select: { conversationId: true, campaignId: true, status: true },
    });
    if (!msg) return;
    await this.prisma.message.update({
      where: { waMessageId },
      data: { status },
    });
    // Métricas de campaña: acumula entregados/leídos/fallidos.
    if (msg.campaignId && msg.status !== status) {
      const field =
        status === MessageStatus.DELIVERED
          ? "deliveredCount"
          : status === MessageStatus.READ
            ? "readCount"
            : status === MessageStatus.FAILED
              ? "failedCount"
              : null;
      if (field) {
        await this.prisma.campaign.update({
          where: { id: msg.campaignId },
          data: { [field]: { increment: 1 } },
        });
      }
    }
    this.notify(msg.conversationId);
  }

  /**
   * Mensaje con botones (sin plantilla). Solo dentro de la ventana de 24h:
   * fuera de ella Meta únicamente admite plantillas aprobadas.
   */
  async queueInteractive(
    input: SendInteractiveInput,
    author: MessageAuthor,
  ): Promise<MessageDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
    });
    if (!conversation) throw new NotFoundException("Conversación no encontrada");
    if (
      !conversation.windowExpiresAt ||
      conversation.windowExpiresAt <= new Date()
    ) {
      throw new BadRequestException(
        "Fuera de la ventana de 24h: solo se pueden enviar plantillas aprobadas.",
      );
    }

    // El id identifica al botón cuando el contacto lo pulsa (llega por webhook).
    const buttons = input.buttons.map((b, i) => ({
      id: b.id?.trim() || `btn_${i + 1}`,
      title: b.title,
    }));

    const message = await this.prisma.message.create({
      data: {
        orgId: conversation.orgId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        author,
        content: input.body,
        interactive: {
          buttons,
          ...(input.header ? { header: input.header } : {}),
          ...(input.footer ? { footer: input.footer } : {}),
        } as Prisma.InputJsonValue,
        status: MessageStatus.QUEUED,
      },
    });

    await this.outbound.add("send", {
      messageId: message.id,
      orgId: conversation.orgId,
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        awaitingReply: false,
        ...(author === MessageAuthor.HUMAN
          ? { aiPausedUntil: new Date(Date.now() + this.humanPauseMs), handoffAt: null, handoffReason: null }
          : {}),
      },
    });
    this.notify(conversation.id);
    return this.toMessageDto(message);
  }

  /**
   * Envía una plantilla aprobada a la conversación. Es la única forma de
   * escribir fuera de la ventana de 24h (p. ej. para reactivar un chat).
   */
  async sendTemplateMessage(
    input: SendTemplateMessageInput,
    author: MessageAuthor,
  ): Promise<MessageDto> {
    const [conversation, template] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        include: { contact: true, channel: true },
      }),
      this.prisma.template.findUnique({ where: { id: input.templateId } }),
    ]);
    if (!conversation) throw new NotFoundException("Conversación no encontrada");
    if (!template) throw new NotFoundException("Plantilla no encontrada");
    if (template.status !== "APPROVED") {
      throw new BadRequestException(
        "La plantilla no está aprobada por Meta, así que no se puede enviar.",
      );
    }

    const from = conversation.channel?.phoneNumberId;
    const spec = await this.fills.build(
      {
        name: template.name,
        language: template.language,
        header: (template.header as TemplateHeader | null) ?? null,
        buttons: (template.buttons as TemplateButton[] | null) ?? [],
        body: template.body,
      },
      input.fill,
      conversation.contact,
      from,
    );

    const message = await this.prisma.message.create({
      data: {
        orgId: conversation.orgId,
        conversationId: conversation.id,
        templateId: template.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        author,
        content: this.fills.preview(template.body, spec),
        mediaUrl: input.fill.headerMediaUrl ?? null,
        status: MessageStatus.QUEUED,
      },
    });

    try {
      const res = await this.wa.sendTemplate(
        conversation.contact.phone,
        spec,
        from,
      );
      const sent = await this.prisma.message.update({
        where: { id: message.id },
        data: { waMessageId: res.waMessageId, status: MessageStatus.SENT },
      });
      this.outboundSent(conversation.orgId, conversation.id, sent.id, author);
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          awaitingReply: false,
          ...(author === MessageAuthor.HUMAN
            ? { aiPausedUntil: new Date(Date.now() + this.humanPauseMs), handoffAt: null, handoffReason: null }
            : {}),
        },
      });
      this.notify(conversation.id);
      return this.toMessageDto(sent);
    } catch (e) {
      const failed = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          errorReason: (e as Error).message.slice(0, 500),
        },
      });
      this.notify(conversation.id);
      void failed;
      throw new BadRequestException(
        i18n("template.sendFailed", { reason: (e as Error).message }),
      );
    }
  }

  // ── Saliente: validar ventana, persistir QUEUED y encolar ──────
  async queueOutbound(
    input: SendMessageInput,
    author: MessageAuthor,
  ): Promise<MessageDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
    });
    if (!conversation) throw new NotFoundException("Conversación no encontrada");

    const windowOpen =
      !!conversation.windowExpiresAt &&
      conversation.windowExpiresAt > new Date();

    // Regla 3: fuera de ventana solo se permiten plantillas aprobadas.
    if (!windowOpen && input.type === MessageType.TEXT) {
      throw new BadRequestException(
        "Fuera de la ventana de 24h: solo se pueden enviar plantillas aprobadas.",
      );
    }

    const message = await this.prisma.message.create({
      data: {
        orgId: conversation.orgId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: input.type,
        author,
        content: input.type === MessageType.TEXT ? input.text : input.caption,
        mediaUrl: input.mediaUrl,
        replyToId: input.replyToId ?? null,
        status: MessageStatus.QUEUED,
      },
    });

    await this.outbound.add("send", {
      messageId: message.id,
      orgId: conversation.orgId,
    });

    // Respondimos: la conversación deja de estar "sin responder". Y si responde
    // un humano, pausar la IA un rato (no pisar al agente humano).
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        awaitingReply: false,
        ...(author === MessageAuthor.HUMAN
          ? { aiPausedUntil: new Date(Date.now() + this.humanPauseMs), handoffAt: null, handoffReason: null }
          : {}),
      },
    });

    this.notify(conversation.id);
    return this.toMessageDto(message);
  }

  /**
   * Envía un medio. Si el fichero es nuestro (referencia "storage://"), se
   * sube a Meta en este momento y se manda por media id: así no hace falta
   * que el archivo sea accesible desde internet. Una URL externa se pasa tal
   * cual como `link`, que es lo que Meta espera en ese caso.
   */
  private async sendMediaMessage(
    message: { id: string; type: MessageType; mediaUrl: string | null; content: string | null },
    to: string,
    from?: string,
  ): Promise<{ waMessageId: string }> {
    const kind = message.type === MessageType.IMAGE ? "IMAGE" : "DOCUMENT";
    const caption = message.content ?? undefined;
    const storageId = parseStorageRef(message.mediaUrl);

    if (!storageId) {
      return this.wa.sendMedia(to, kind, message.mediaUrl ?? "", caption, from);
    }

    const file = await this.storage.read(storageId);
    if (!file) {
      throw new Error("El archivo ya no está disponible en el almacenamiento");
    }
    const mediaId = await this.wa.uploadMedia(
      file.buffer,
      file.mimeType,
      storageId,
      from,
    );
    return this.wa.sendMediaById(to, kind, mediaId, caption, from);
  }

  async setAiMode(id: string, mode: AiMode): Promise<ConversationDto> {
    // Cambiar el modo a mano es una orden explícita del agente humano, así que
    // levanta la pausa que deja su propia intervención: si no, activar
    // Autopilot no hacía nada visible hasta pasados los 15 minutos.
    const c = await this.prisma.conversation
      .update({
        where: { id },
        data: { aiMode: mode, aiPausedUntil: null },
        include: { contact: { include: { tags: { include: { tag: true } }, source: true } }, assignedAgent: true, channel: true },
      })
      .catch(() => {
        throw new NotFoundException("Conversación no encontrada");
      });
    this.notify(c.id);
    return this.toConversationDto(c);
  }

  // ── Procesamiento del envío (lo invoca el OutboundProcessor) ───
  async processOutbound(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: { include: { contact: true, channel: true } },
        // El waMessageId del citado es lo que Meta necesita en `context`.
        replyTo: { select: { waMessageId: true } },
      },
    });
    if (!message) return;
    if (message.status === MessageStatus.SENT) return; // ya enviado (reintento)

    const to = message.conversation.contact.phone;
    // Responder por el mismo número (canal) por el que entró la conversación.
    const from = message.conversation.channel?.phoneNumberId;
    const interactive = message.interactive as {
      buttons?: { id: string; title: string }[];
      header?: string;
      footer?: string;
    } | null;

    const result = interactive?.buttons?.length
      ? await this.wa.sendInteractiveButtons(
          to,
          message.content ?? "",
          interactive.buttons,
          { header: interactive.header, footer: interactive.footer },
          from,
        )
      : message.type === MessageType.TEXT
        ? await this.wa.sendText(
            to,
            message.content ?? "",
            from,
            message.replyTo?.waMessageId ?? undefined,
          )
        : await this.sendMediaMessage(message, to, from);

    await this.prisma.message.update({
      where: { id: message.id },
      data: { waMessageId: result.waMessageId, status: MessageStatus.SENT },
    });
    this.outboundSent(message.orgId, message.conversationId, message.id, message.author);
    this.notify(message.conversationId);
  }

  async markFailed(messageId: string, reason: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, errorReason: reason.slice(0, 500) },
    });
  }

  // ── Consultas para la bandeja ──────────────────────────────────
  async listConversations(
    userId: string,
    opts: ConversationsQuery,
    role?: string,
  ): Promise<ConversationDto[]> {
    const where: Prisma.ConversationWhereInput = {};

    // Estado: si se indica, filtra; si no, oculta las cerradas.
    if (opts.status) where.status = opts.status;
    else where.status = { not: "CLOSED" };

    // Asignación.
    if (opts.filter === "unassigned") where.assignedAgentId = null;
    else if (opts.filter === "mine") where.assignedAgentId = userId;

    // Estado de respuesta: pendientes (el contacto espera) vs respondidas.
    if (opts.reply === "pending") where.awaitingReply = true;
    else if (opts.reply === "replied") where.awaitingReply = false;

    // Vendedor concreto (del panel de filtros): manda sobre Todas/Sin asignar/Mías.
    if (opts.agentId) where.assignedAgentId = opts.agentId === FILTER_NONE ? null : opts.agentId;
    if (opts.channelId) where.channelId = opts.channelId;
    if (opts.from || opts.to) {
      where.lastMessageAt = {
        ...(opts.from ? { gte: new Date(opts.from) } : {}),
        ...(opts.to ? { lte: new Date(opts.to) } : {}),
      };
    }

    // Condiciones sobre el contacto: fuente, etiquetas y texto buscado.
    const contact: Prisma.ContactWhereInput = {};
    if (opts.tags?.length) {
      if (opts.tags.includes(FILTER_NONE)) contact.tags = { none: {} };
      else contact.AND = opts.tags.map((name) => ({ tags: { some: { tag: { name } } } }));
    }
    if (opts.q) {
      contact.OR = [
        { name: { contains: opts.q, mode: "insensitive" } },
        { phone: { contains: opts.q.replace(/[^\d+]/g, "") || opts.q } },
      ];
    }
    // Vendedor (no admin): solo conversaciones de sus fuentes asignadas. Si
    // además filtra por fuente, se cruza con las suyas (`in: []` = nada).
    if (role && role !== "ADMIN") {
      const assigned = await this.prisma.userSource.findMany({
        where: { userId },
        select: { sourceId: true },
      });
      let allowed = assigned.map((a) => a.sourceId);
      if (opts.sourceId) allowed = allowed.filter((id) => id === opts.sourceId);
      contact.sourceId = { in: allowed };
    } else if (opts.sourceId) {
      contact.sourceId = opts.sourceId === FILTER_NONE ? null : opts.sourceId;
    }
    if (Object.keys(contact).length) where.contact = contact;

    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      include: {
        contact: { include: { tags: { include: { tag: true } }, source: true } },
        assignedAgent: true,
        channel: true,
        // El último mensaje, para la vista previa de la fila.
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { direction: true, type: true, content: true, author: true, createdAt: true },
        },
      },
      take: 100,
    });
    return rows.map((c) => this.toConversationDto(c));
  }

  /** Alguien abrió el chat: los mensajes del contacto ya no cuentan como nuevos. */
  async markRead(id: string): Promise<ConversationDto> {
    const c = await this.prisma.conversation
      .update({
        where: { id },
        data: { unreadCount: 0, lastReadAt: new Date() },
        include: { contact: { include: { tags: { include: { tag: true } }, source: true } }, assignedAgent: true, channel: true },
      })
      .catch(() => {
        throw new NotFoundException("Conversación no encontrada");
      });
    // Que las demás pestañas y compañeros dejen de ver el contador.
    this.notify(c.id);
    return this.toConversationDto(c);
  }

  async assignConversation(
    id: string,
    agentId: string | null,
  ): Promise<ConversationDto> {
    if (agentId) {
      const agent = await this.prisma.user.findUnique({ where: { id: agentId } });
      if (!agent) throw new NotFoundException("Agente no encontrado");
    }
    const c = await this.prisma.conversation
      .update({
        where: { id },
        data: { assignedAgentId: agentId },
        include: { contact: { include: { tags: { include: { tag: true } }, source: true } }, assignedAgent: true, channel: true },
      })
      .catch(() => {
        throw new NotFoundException("Conversación no encontrada");
      });
    this.notify(c.id);
    return this.toConversationDto(c);
  }

  async setStatus(
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationDto> {
    const c = await this.prisma.conversation
      .update({
        where: { id },
        data: { status, ...(status !== "PENDING" ? { handoffAt: null, handoffReason: null } : {}) },
        include: { contact: { include: { tags: { include: { tag: true } }, source: true } }, assignedAgent: true, channel: true },
      })
      .catch(() => {
        throw new NotFoundException("Conversación no encontrada");
      });
    this.notify(c.id);
    // El copiloto actualiza la memoria del cliente en segundo plano.
    if (status === "CLOSED") {
      this.events.emit("conversation.closed", { conversationId: c.id, orgId: c.orgId });
    }
    return this.toConversationDto(c);
  }

  // ── Notas internas ─────────────────────────────────────────────
  async listNotes(conversationId: string): Promise<NoteDto[]> {
    const rows = await this.prisma.note.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { author: true },
    });
    return rows.map((n) => ({
      id: n.id,
      body: n.body,
      author: { id: n.author.id, name: n.author.name },
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async addNote(
    conversationId: string,
    authorId: string,
    body: string,
  ): Promise<NoteDto> {
    const n = await this.prisma.note.create({
      data: { conversationId, authorId, body },
      include: { author: true },
    });
    return {
      id: n.id,
      body: n.body,
      author: { id: n.author.id, name: n.author.name },
      createdAt: n.createdAt.toISOString(),
    };
  }

  private toConversationDto(c: {
    id: string;
    status: string;
    aiMode: string;
    aiPausedUntil: Date | null;
    awaitingReply: boolean;
    handoffAt?: Date | null;
    handoffReason?: string | null;
    windowExpiresAt: Date | null;
    lastMessageAt: Date | null;
    unreadCount?: number;
    contact: {
      id: string;
      phone: string;
      name: string | null;
      tags?: { tag: { name: string; color: string | null } }[];
      source?: { id: string; name: string; color: string | null } | null;
    };
    assignedAgent: { id: string; name: string | null } | null;
    channel?: {
      id: string;
      label: string | null;
      displayPhoneNumber: string | null;
    } | null;
    // Solo el listado lo trae (take: 1); el resto de llamadas no lo necesita.
    messages?: {
      direction: string;
      type: string;
      content: string | null;
      author: string;
      createdAt: Date;
    }[];
  }): ConversationDto {
    const now = new Date();
    const last = c.messages?.[0];
    return {
      id: c.id,
      status: c.status as ConversationStatus,
      unreadCount: c.unreadCount ?? 0,
      handoffAt: c.handoffAt?.toISOString() ?? null,
      handoffReason: c.handoffReason ?? null,
      lastMessage: last
        ? {
            direction: last.direction as MessageDirection,
            type: last.type as MessageType,
            author: last.author as MessageAuthor,
            text: last.content,
            at: last.createdAt.toISOString(),
          }
        : null,
      contact: {
        id: c.contact.id,
        phone: c.contact.phone,
        name: c.contact.name,
        tags: (c.contact.tags ?? []).map((ct) => ({
          name: ct.tag.name,
          color: ct.tag.color,
        })),
        source: c.contact.source
          ? {
              id: c.contact.source.id,
              name: c.contact.source.name,
              color: c.contact.source.color,
            }
          : null,
      },
      assignedAgent: c.assignedAgent
        ? { id: c.assignedAgent.id, name: c.assignedAgent.name }
        : null,
      channel: c.channel
        ? {
            id: c.channel.id,
            label: c.channel.label,
            displayPhoneNumber: c.channel.displayPhoneNumber,
          }
        : null,
      aiMode: c.aiMode as AiMode,
      aiPaused: !!c.aiPausedUntil && c.aiPausedUntil > now,
      awaitingReply: c.awaitingReply,
      windowExpiresAt: c.windowExpiresAt?.toISOString() ?? null,
      windowOpen: !!c.windowExpiresAt && c.windowExpiresAt > now,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    };
  }

  async getMessages(conversationId: string): Promise<MessageDto[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return rows.map((m) => this.toMessageDto(m));
  }

  /** Mensajes sin leer en la bandeja (y en cuántas conversaciones). */
  async unreadCount(): Promise<UnreadCount> {
    const agg = await this.prisma.conversation.aggregate({
      where: { status: { not: "CLOSED" }, unreadCount: { gt: 0 } },
      _sum: { unreadCount: true },
      _count: { _all: true },
    });
    return { unread: agg._sum.unreadCount ?? 0, conversations: agg._count._all };
  }

  private toMessageDto(m: {
    id: string;
    direction: string;
    type: string;
    author: string;
    content: string | null;
    mediaUrl: string | null;
    transcript?: string | null;
    replyTo?: {
      id: string;
      content: string | null;
      type: MessageType;
      direction: MessageDirection;
    } | null;
    reaction?: string | null;
    status: string;
    createdAt: Date;
    interactive?: unknown;
  }): MessageDto {
    const interactive = m.interactive as {
      buttons?: { id: string; title: string }[];
    } | null;
    return {
      id: m.id,
      direction: m.direction as MessageDirection,
      type: m.type as MessageType,
      author: m.author as MessageAuthor,
      content: m.content,
      mediaUrl: m.mediaUrl,
      transcript: m.transcript ?? null,
      buttons: interactive?.buttons?.length ? interactive.buttons : null,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.content,
            type: m.replyTo.type,
            direction: m.replyTo.direction,
          }
        : null,
      reaction: m.reaction ?? null,
      status: m.status as MessageStatus,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

/**
 * Fuente automática de los contactos que llegan por WhatsApp ("WhatsApp") o
 * por un anuncio de Meta ("Anuncio de Meta"). Se crea una vez por empresa y
 * se reutiliza; si la empresa la renombra, se crea otra antes que pisar la
 * suya. Sirve para que el vendedor asignado a esa fuente vea al contacto sin
 * que nadie lo etiquete a mano.
 */
async function fuenteAutomatica(
  prisma: PrismaService,
  orgId: string,
  kind: "whatsapp" | "ad",
): Promise<string> {
  const name = kind === "ad" ? "Anuncio de Meta" : "WhatsApp";
  const color = kind === "ad" ? "#1877f2" : "#25d366";
  const s = await prisma.source.upsert({
    where: { orgId_name: { orgId, name } },
    create: { orgId, name, color },
    update: {},
    select: { id: true },
  });
  return s.id;
}
