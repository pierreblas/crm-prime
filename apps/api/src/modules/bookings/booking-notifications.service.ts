import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import {
  ConversationStatus,
  MessageAuthor,
  MessageType,
  formatBookingDay,
  utcToZoned,
  type BookingSettingsDto,
  type BookingTemplateVarSource,
  type WebhookEvent,
} from "@crm/shared";
import { env } from "../../common/utils/env";
import { fold } from "../../common/utils/fold";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { MessagingService } from "../messaging/messaging.service";
import { WebhookOutService } from "../webhooks-out/webhook-out.service";
import { BookingsService } from "./bookings.service";

const SWEEP_EVERY_MS = 60_000;
const BATCH = 50;
/** Un «Confirmar» o «Cancelar» suelto solo cuenta si hubo recordatorio hace poco. */
const REPLY_WINDOW_MS = 3 * 24 * 3_600_000;
const CONFIRM_ID = "booking_confirm";
const CANCEL_ID = "booking_cancel";

/** Lo que emite BookingsService con cada cita creada, movida o cancelada. */
export interface BookingEvent {
  orgId: string;
  bookingId: string;
  contactId: string;
  conversationId: string | null;
  startAt: string;
  source?: string;
  actor?: string | null;
  previousStartAt?: string;
}

const ROW = {
  service: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  contact: { select: { id: true, name: true, phone: true } },
  org: { select: { name: true } },
} satisfies Prisma.BookingInclude;
type Row = Prisma.BookingGetPayload<{ include: typeof ROW }>;
type Kind = "confirm" | "reminder";
type Values = Record<BookingTemplateVarSource, string>;

/**
 * Avisos de cita por WhatsApp y hacia fuera.
 *
 * - Confirmación cuando el equipo crea o mueve una cita (el agente de IA no
 *   la necesita: ya se lo dijo en el chat).
 * - Recordatorio X horas antes, con botones Confirmar / Cancelar que actúan
 *   sobre la cita. Un barrido por minuto, igual que los seguimientos.
 * - Webhooks `booking.*` para quien los tenga suscritos.
 *
 * Dentro de la ventana de 24 h se escribe en texto (gratis, y con botones de
 * verdad); fuera, con la plantilla aprobada que eligió la empresa; sin
 * plantilla y sin ventana, no sale nada y queda en el log.
 */
@Injectable()
export class BookingNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("BookingNotifications");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly webhooks: WebhookOutService,
    private readonly bookings: BookingsService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    if (env("BOOKING_REMINDERS_SWEEP") === "off") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── La cita cambia: webhook y, si toca, confirmación ────────
  @OnEvent("booking.created", { async: true })
  async onCreated(e: BookingEvent): Promise<void> {
    await this.handle(e, "booking.created");
  }

  @OnEvent("booking.rescheduled", { async: true })
  async onRescheduled(e: BookingEvent): Promise<void> {
    await this.handle(e, "booking.rescheduled");
  }

  @OnEvent("booking.cancelled", { async: true })
  async onCancelled(e: BookingEvent): Promise<void> {
    await this.handle(e, "booking.cancelled");
  }

  private async handle(e: BookingEvent, event: WebhookEvent & `booking.${string}`): Promise<void> {
    try {
      await runInOrg(e.orgId, async () => {
        const row = await this.load(e.bookingId);
        if (!row) return;
        void this.webhooks.emit(event, {
          booking: this.payload(row),
          ...(e.previousStartAt ? { previousStartAt: e.previousStartAt } : {}),
        });
        if (event === "booking.cancelled") return;
        if (e.actor === "ai" || row.source === "ai") return;
        const settings = await this.bookings.settings();
        if (!settings.confirmOnCreate) return;
        await this.send(row, "confirm", settings);
      });
    } catch (err) {
      this.logger.error(`${event} ${e.bookingId}: ${(err as Error).message}`);
    }
  }

  // ── Recordatorios ───────────────────────────────────────────
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await runUnscoped("recordatorios de cita vencidos", () =>
        this.prisma.booking.findMany({
          where: { reminderAt: { lte: new Date() }, reminderSentAt: null, status: "CONFIRMED" },
          select: { id: true, orgId: true },
          orderBy: { reminderAt: "asc" },
          take: BATCH,
        }),
      );
      for (const b of due) {
        try {
          await runInOrg(b.orgId, () => this.remind(b.id));
        } catch (e) {
          this.logger.error(`Recordatorio de la cita ${b.id}: ${(e as Error).message}`);
        }
      }
      return due.length;
    } catch (e) {
      this.logger.error(`Barrido de recordatorios: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Manda el recordatorio de una cita. Se marca antes de enviar: si falla, queda el mensaje fallido en la bandeja y no se repite cada minuto. */
  async remind(id: string): Promise<boolean> {
    const claimed = await this.prisma.booking.updateMany({
      where: { id, reminderSentAt: null, status: "CONFIRMED" },
      data: { reminderSentAt: new Date() },
    });
    if (claimed.count === 0) return false;
    const row = await this.load(id);
    if (!row || row.startAt.getTime() <= Date.now()) return false;
    const sent = await this.send(row, "reminder", await this.bookings.settings());
    this.events.emit("bookings.changed", { orgId: row.orgId, bookingId: row.id });
    return sent;
  }

  // ── El cliente responde al recordatorio ─────────────────────
  /**
   * «Confirmar» o «Cancelar» (botón o texto) tras un recordatorio reciente:
   * actúa sobre la cita y responde. Devuelve true si lo atendió, para que
   * flujos y agente no contesten también.
   */
  async onInbound(conversationId: string, messageId?: string): Promise<boolean> {
    if (!messageId) return false;
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { buttonPayload: true, content: true, conversation: { select: { contactId: true } } },
    });
    if (!msg) return false;
    const intent = intentOf(msg.buttonPayload) ?? intentOf(msg.content);
    if (!intent) return false;

    const booking = await this.prisma.booking.findFirst({
      where: {
        contactId: msg.conversation.contactId,
        status: "CONFIRMED",
        startAt: { gt: new Date() },
        reminderSentAt: { gte: new Date(Date.now() - REPLY_WINDOW_MS) },
      },
      orderBy: { startAt: "asc" },
      include: ROW,
    });
    if (!booking) return false;

    const v = this.values(booking, (await this.bookings.settings()).timezone);
    const name = v.contact_name ? `, ${v.contact_name}` : "";
    if (intent === "confirm") {
      if (!booking.confirmedByContactAt) await this.bookings.confirmByContact(booking.id);
      await this.text(conversationId, `Gracias${name}. Tu cita de ${v.service} queda confirmada: ${v.date} a las ${v.time}.`);
    } else {
      await this.bookings.cancel(booking.id, "El cliente canceló desde el recordatorio");
      await this.text(conversationId, `Listo${name}, cancelamos tu cita de ${v.service} del ${v.date}. Si quieres otra hora, escríbenos por aquí.`);
    }
    return true;
  }

  // ── Envío ───────────────────────────────────────────────────
  private async send(row: Row, kind: Kind, settings: BookingSettingsDto): Promise<boolean> {
    const conversation = await this.conversationFor(row);
    if (!conversation) {
      this.logger.warn(`Cita ${row.id}: no hay número de WhatsApp conectado para avisar al cliente`);
      return false;
    }
    const v = this.values(row, settings.timezone);
    const windowOpen = !!conversation.windowExpiresAt && conversation.windowExpiresAt.getTime() > Date.now();

    if (windowOpen) {
      if (kind === "confirm") {
        await this.text(conversation.id, this.confirmText(v));
      } else {
        await this.messaging.queueInteractive(
          {
            conversationId: conversation.id,
            body: this.reminderText(v),
            buttons: [
              { id: CONFIRM_ID, title: "Confirmar" },
              { id: CANCEL_ID, title: "Cancelar" },
            ],
          },
          MessageAuthor.AI,
        );
      }
      return true;
    }

    const templateId = kind === "confirm" ? settings.confirmTemplateId : settings.reminderTemplateId;
    const sources = kind === "confirm" ? settings.confirmTemplateVars : settings.reminderTemplateVars;
    if (!templateId) {
      this.logger.warn(`Cita ${row.id}: ${kind === "confirm" ? "confirmación" : "recordatorio"} fuera de la ventana de 24 h y sin plantilla; no se envió`);
      return false;
    }
    await this.messaging.sendTemplateMessage(
      {
        conversationId: conversation.id,
        templateId,
        fill: { body: sources.map((src, i) => ({ index: i + 1, source: "static" as const, value: v[src] })), urlButtons: [] },
      },
      MessageAuthor.AI,
    );
    return true;
  }

  private text(conversationId: string, text: string): Promise<unknown> {
    return this.messaging.queueOutbound({ conversationId, type: MessageType.TEXT, text }, MessageAuthor.AI);
  }

  private confirmText(v: Values): string {
    const who = v.contact_name ? `Hola, ${v.contact_name}. ` : "";
    return `${who}Tu cita quedó confirmada: ${v.service}, ${v.date} a las ${v.time}${v.staff ? ` con ${v.staff}` : ""}. Si necesitas cambiarla, escríbenos por aquí.`;
  }

  private reminderText(v: Values): string {
    const who = v.contact_name ? `Hola, ${v.contact_name}. ` : "";
    return `${who}Te recordamos tu cita de ${v.service}: ${v.date} a las ${v.time}${v.staff ? ` con ${v.staff}` : ""}. ¿Vienes?`;
  }

  /**
   * La conversación de la cita si sigue abierta; si no, la última abierta del
   * contacto; si no hay ninguna, se abre una por el número con el que ya
   * hablaron (o el primero conectado). Sin número, no hay a quién avisar.
   */
  private async conversationFor(row: Row): Promise<{ id: string; windowExpiresAt: Date | null } | null> {
    const notClosed = { status: { not: ConversationStatus.CLOSED } };
    const select = { id: true, windowExpiresAt: true };
    const own = row.conversationId
      ? await this.prisma.conversation.findFirst({ where: { id: row.conversationId, ...notClosed }, select })
      : null;
    if (own) return own;
    const open = await this.prisma.conversation.findFirst({ where: { contactId: row.contactId, ...notClosed }, orderBy: { updatedAt: "desc" }, select });
    if (open) return open;
    const last = await this.prisma.conversation.findFirst({ where: { contactId: row.contactId }, orderBy: { updatedAt: "desc" }, select: { channelId: true } });
    const channelId =
      last?.channelId ?? (await this.prisma.whatsappConnection.findFirst({ where: { isActive: true, status: "connected" }, select: { id: true } }))?.id ?? null;
    if (!channelId) return null;
    return this.prisma.conversation.create({
      data: { orgId: row.orgId, contactId: row.contactId, channelId, status: ConversationStatus.OPEN, lastMessageAt: new Date() },
      select,
    });
  }

  private load(id: string): Promise<Row | null> {
    return this.prisma.booking.findUnique({ where: { id }, include: ROW });
  }

  private values(row: Row, tz: string): Values {
    const z = utcToZoned(row.startAt, tz);
    const date = formatBookingDay(z.date);
    return {
      contact_name: row.contact.name?.trim() ?? "",
      date,
      time: z.time,
      datetime: `${date}, ${z.time}`,
      service: row.serviceName,
      staff: row.user?.name ?? row.user?.email ?? "",
      business: row.org.name,
    };
  }

  private payload(row: Row): Record<string, unknown> {
    return {
      id: row.id,
      status: row.status,
      source: row.source,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      service: row.service,
      serviceName: row.serviceName,
      staff: row.user ? { id: row.user.id, name: row.user.name ?? row.user.email } : null,
      contact: row.contact,
      dealId: row.dealId,
      conversationId: row.conversationId,
      note: row.note,
      cancelReason: row.cancelReason,
    };
  }
}

/** «Confirmar» / «Cancelar» en botón o escrito, sin tildes ni mayúsculas. */
function intentOf(raw: string | null | undefined): "confirm" | "cancel" | null {
  const s = fold((raw ?? "").trim()).replace(/[^a-z_ ]/g, "");
  if (!s) return null;
  if (s === CONFIRM_ID || /^(confirmar|confirmo|confirmado|confirmada)$/.test(s)) return "confirm";
  if (s === CANCEL_ID || /^(cancelar|cancelo|cancelado|cancelada)$/.test(s)) return "cancel";
  return null;
}
