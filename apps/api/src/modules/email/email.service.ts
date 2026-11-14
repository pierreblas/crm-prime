import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { Contact, Email, Prisma } from "@prisma/client";
import {
  CONTACT_EMAIL_KEY,
  buildEmailVars,
  contactEmailOf,
  emailTextToHtml,
  renderEmailText,
  withEmailSignature,
  type AccessTokenClaims,
  type EmailAttachment,
  type EmailComposeContext,
  type EmailDto,
  type EmailProvider,
  type EmailStatus,
  type EmailUnsubscribeDto,
  type SendEmailInput,
} from "@crm/shared";
import { QUEUE_EMAIL } from "../../infra/queue/queue.constants";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { STORAGE_PROVIDER, parseStorageRef, type StorageProvider } from "../../infra/storage/storage.provider";
import { TenantService } from "../../infra/tenant/tenant.service";
import { PermissionsService } from "../permissions/permissions.service";
import { EmailAccountsService } from "./email-accounts.service";
import { readAttachments } from "./email-templates.service";
import { EMAIL_TRANSPORT, SmtpError, type EmailTransport, type OutgoingEmail } from "./email.transport";
import { unsubscribeUrl } from "./email-unsubscribe";

export interface EmailJob {
  emailId: string;
  orgId: string;
}

export interface AutomatedEmail {
  contactId: string;
  conversationId: string | null;
  templateId: string;
  /** Buzón elegido en el bloque: un id, «assignee» o «default». */
  account?: string;
  /** Variables del flujo. */
  vars: Record<string, string>;
  /** De dónde sale, para el historial y la nota («Flujo «Bienvenida»»). */
  origin: string;
}

const fields = (c: Pick<Contact, "metadata">): Record<string, string> => {
  const out: Record<string, string> = {};
  if (c.metadata && typeof c.metadata === "object" && !Array.isArray(c.metadata)) {
    for (const [k, v] of Object.entries(c.metadata as Record<string, unknown>)) if (v != null) out[k] = String(v);
  }
  return out;
};

/** El asunto es una sola línea: un salto de línea ahí rompería las cabeceras del correo. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/**
 * Correos a los contactos, desde el buzón de la empresa.
 *
 * A mano: una persona escribe (con o sin plantilla) y el envío se hace en el
 * momento, para decirle si salió. Automático: lo pide un flujo, sale por la
 * cola con reintentos, lleva enlace de baja y respeta la lista de bajas.
 * Todo queda en la tabla `emails` (el historial de correo del contacto) y como
 * nota en su chat.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger("Email");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly accounts: EmailAccountsService,
    private readonly perms: PermissionsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    @InjectQueue(QUEUE_EMAIL) private readonly queue: Queue<EmailJob>,
  ) {}

  // ── Redactar ────────────────────────────────────────────────
  async compose(contactId: string, user: AccessTokenClaims): Promise<EmailComposeContext> {
    const contact = await this.contactFor(contactId, user.sub);
    const to = contactEmailOf(fields(contact));
    const [vars, accounts, unsubscribed] = await Promise.all([
      this.varsFor(contact, user.sub),
      this.accounts.usableBy(user.sub),
      to ? this.isUnsubscribed(to) : false,
    ]);
    return { to, vars, accounts, unsubscribed };
  }

  /** Envío a mano. Devuelve el correo ya enviado, o un error con el motivo si el servidor lo rechazó. */
  async send(input: SendEmailInput, user: AccessTokenClaims): Promise<EmailDto> {
    const contact = await this.contactFor(input.contactId, user.sub);
    const account = await this.accounts.forUser(input.accountId, user.sub);
    const to = input.to ?? contactEmailOf(fields(contact));
    if (!to) throw new BadRequestException("Este contacto no tiene correo: escribe la dirección a la que enviar");
    await this.assertUnderLimit(account.id, account.dailyLimit, account.address);

    if (input.to && input.saveToContact) {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: { metadata: { ...fields(contact), [CONTACT_EMAIL_KEY]: input.to } as Prisma.InputJsonObject },
      });
    }
    // Lo que la persona ve en pantalla ya viene con las variables puestas; se
    // pasan otra vez por si escribió alguna a mano.
    const vars = await this.varsFor(contact, user.sub);
    const convo = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      select: { id: true },
    });
    const email = await this.prisma.email.create({
      data: {
        orgId: this.tenant.orgId(),
        contactId: contact.id,
        conversationId: convo?.id ?? null,
        accountId: account.id,
        templateId: input.templateId && (await this.templateExists(input.templateId)) ? input.templateId : null,
        userId: user.sub,
        fromAddress: account.address,
        fromName: account.fromName ?? (await this.orgName()),
        toAddress: to,
        subject: oneLine(renderEmailText(input.subject, vars)),
        bodyText: renderEmailText(input.body, vars),
        attachments: input.attachments as unknown as Prisma.InputJsonValue,
      },
    });
    const done = await this.deliver(email.id);
    if (!done || done.status !== "sent") {
      throw new BadRequestException(done?.errorReason ?? "No se pudo enviar el correo");
    }
    return (await this.toDtos([done]))[0]!;
  }

  // ── Automático (flujos) ─────────────────────────────────────
  /**
   * Encola un correo de plantilla para un contacto. No lanza: devuelve el
   * motivo si no se puede enviar, para que quien lo pidió lo deje anotado.
   */
  async sendAutomated(req: AutomatedEmail): Promise<{ ok: true } | { ok: false; reason: string }> {
    const template = await this.prisma.emailTemplate.findUnique({ where: { id: req.templateId } });
    if (!template) return { ok: false, reason: "la plantilla de correo ya no existe" };
    const contact = await this.prisma.contact.findUnique({ where: { id: req.contactId } });
    if (!contact) return { ok: false, reason: "el contacto ya no existe" };
    const to = contactEmailOf(fields(contact));
    if (!to) return { ok: false, reason: "el contacto no tiene correo" };
    if (await this.isUnsubscribed(to)) return { ok: false, reason: `${to} pidió no recibir correos automáticos` };

    const convo = req.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: req.conversationId }, select: { assignedAgent: { select: { id: true, name: true } } } })
      : null;
    const account = await this.accounts.forAutomation(req.account, convo?.assignedAgent?.id ?? null);
    if (!account) return { ok: false, reason: "no hay un buzón de la empresa conectado (Ajustes › Correo)" };
    if ((await this.accounts.sentToday(account.id)) >= account.dailyLimit) {
      return { ok: false, reason: `el buzón ${account.address} llegó a su tope de ${account.dailyLimit} correos por día` };
    }

    const orgName = await this.orgName();
    const fromName = account.fromName ?? orgName;
    const vars = buildEmailVars({
      contact: { name: contact.name, phone: contact.phone, fields: fields(contact) },
      orgName,
      senderName: convo?.assignedAgent?.name ?? fromName,
      extra: req.vars,
    });
    const email = await this.prisma.email.create({
      data: {
        orgId: contact.orgId,
        contactId: contact.id,
        conversationId: req.conversationId,
        accountId: account.id,
        templateId: template.id,
        origin: req.origin,
        fromAddress: account.address,
        fromName,
        toAddress: to,
        subject: oneLine(renderEmailText(template.subject, vars)),
        bodyText: withEmailSignature(renderEmailText(template.body, vars), account.signature),
        attachments: (template.attachments ?? []) as Prisma.InputJsonValue,
        automated: true,
      },
    });
    await this.queue.add("send", { emailId: email.id, orgId: contact.orgId });
    return { ok: true };
  }

  // ── Entrega ─────────────────────────────────────────────────
  /**
   * Manda un correo que espera en `queued`. Con `final = false` (la cola aún
   * tiene intentos) un fallo pasajero se relanza para que se reintente; en el
   * último intento, o si el fallo no tiene arreglo, el correo queda como fallido.
   */
  async deliver(emailId: string, final = true): Promise<Email | null> {
    const email = await this.prisma.email.findUnique({ where: { id: emailId }, include: { account: true } });
    if (!email || email.status !== "queued") return email;
    if (!email.account) return this.fail(email, "el buzón desde el que salía ya no existe");
    // Pudo darse de baja entre que se encoló y ahora.
    if (email.automated && (await this.isUnsubscribed(email.toAddress))) {
      return this.fail(email, `${email.toAddress} pidió no recibir correos automáticos`);
    }

    let mail: OutgoingEmail;
    try {
      mail = await this.build(email, email.account.address);
    } catch (e) {
      return this.fail(email, (e as Error).message);
    }
    try {
      const { messageId } = await this.transport.send(this.accounts.credentials(email.account), mail);
      const sent = await this.prisma.email.update({
        where: { id: email.id },
        data: { status: "sent", sentAt: new Date(), messageId: messageId || null, errorReason: null },
      });
      await this.accounts.markResult(email.account.id, null);
      await this.note(sent, `correo enviado a ${sent.toAddress} · «${sent.subject}»`);
      return sent;
    } catch (e) {
      const err = e as Error;
      await this.accounts.markResult(email.account.id, err);
      if (!final && err instanceof SmtpError && err.retryable) throw err;
      return this.fail(email, this.accounts.readable(err, email.account.provider as EmailProvider));
    }
  }

  // ── Historial ───────────────────────────────────────────────
  async history(contactId: string, user: AccessTokenClaims): Promise<EmailDto[]> {
    await this.contactFor(contactId, user.sub);
    const rows = await this.prisma.email.findMany({ where: { contactId }, orderBy: { createdAt: "desc" }, take: 50 });
    return this.toDtos(rows);
  }

  // ── Bajas ───────────────────────────────────────────────────
  async unsubscribes(): Promise<EmailUnsubscribeDto[]> {
    const rows = await this.prisma.emailUnsubscribe.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    return rows.map((r) => ({ id: r.id, address: r.address, createdAt: r.createdAt.toISOString() }));
  }

  async removeUnsubscribe(id: string): Promise<{ ok: true }> {
    const row = await this.prisma.emailUnsubscribe.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Esa dirección no está en la lista de bajas");
    await this.prisma.emailUnsubscribe.delete({ where: { id } });
    return { ok: true };
  }

  /** Apunta la baja de una dirección. Idempotente. La llama la página pública, ya dentro de la empresa. */
  async unsubscribe(orgId: string, address: string): Promise<void> {
    const clean = address.trim().toLowerCase();
    await this.prisma.emailUnsubscribe.upsert({
      where: { orgId_address: { orgId, address: clean } },
      create: { orgId, address: clean },
      update: {},
    });
  }

  // ── Internos ────────────────────────────────────────────────
  private async isUnsubscribed(address: string): Promise<boolean> {
    return !!(await this.prisma.emailUnsubscribe.findFirst({ where: { address: address.toLowerCase() }, select: { id: true } }));
  }

  /** El contacto, si esta persona puede verlo. */
  private async contactFor(contactId: string, userId: string): Promise<Contact> {
    const scope = await this.perms.contactWhere(userId);
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, ...(scope ?? {}) } });
    if (!contact) throw new NotFoundException("Contacto no encontrado");
    return contact;
  }

  private async varsFor(contact: Contact, userId: string): Promise<Record<string, string>> {
    const [orgName, sender, seesPhone] = await Promise.all([
      this.orgName(),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      this.perms.canSeePhone(userId),
    ]);
    const vars = buildEmailVars({
      contact: { name: contact.name, phone: contact.phone, fields: fields(contact) },
      orgName,
      senderName: sender?.name ?? null,
    });
    // Quien no puede ver el teléfono tampoco lo saca escribiéndolo en un correo.
    return seesPhone ? vars : { ...vars, telefono: "" };
  }

  private async orgName(): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: this.tenant.orgId() }, select: { name: true } });
    return org?.name ?? "";
  }

  private async templateExists(id: string): Promise<boolean> {
    return !!(await this.prisma.emailTemplate.findUnique({ where: { id }, select: { id: true } }));
  }

  private async assertUnderLimit(accountId: string, limit: number, address: string): Promise<void> {
    if ((await this.accounts.sentToday(accountId)) >= limit) {
      throw new BadRequestException(`El buzón ${address} llegó a su tope de ${limit} correos por día. Se puede ampliar en Ajustes › Correo.`);
    }
  }

  /** El correo listo para el servidor: cuerpo en texto y HTML, adjuntos y, si es automático, la baja. */
  private async build(email: Email, fromAddress: string): Promise<OutgoingEmail> {
    const attachments: OutgoingEmail["attachments"] = [];
    for (const a of readAttachments(email.attachments) as EmailAttachment[]) {
      const id = parseStorageRef(a.ref);
      const file = id ? await this.storage.read(id) : null;
      if (!file) throw new Error(`el adjunto «${a.name}» ya no está disponible`);
      attachments.push({ filename: a.name, content: file.buffer, contentType: file.mimeType });
    }
    const leave = email.automated ? unsubscribeUrl(email.orgId, email.toAddress) : null;
    if (email.automated && !leave) {
      this.logger.warn("Correo automático sin enlace de baja: falta API_PUBLIC_URL (o SAAS_BASE_DOMAIN) en el servidor");
    }
    const who = email.fromName ?? fromAddress;
    return {
      from: { name: who, address: fromAddress },
      to: email.toAddress,
      subject: email.subject,
      text: leave ? `${email.bodyText}\n\n--\nSi no quieres recibir más correos automáticos de ${who}, date de baja aquí: ${leave}` : email.bodyText,
      html:
        emailTextToHtml(email.bodyText) +
        (leave
          ? `<p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280">Si no quieres recibir más correos automáticos de ${escapeHtml(who)}, <a href="${leave}" style="color:#6b7280">date de baja aquí</a>.</p>`
          : ""),
      attachments,
      headers: leave ? { "List-Unsubscribe": `<${leave}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    };
  }

  private async fail(email: Email, reason: string): Promise<Email> {
    const failed = await this.prisma.email.update({
      where: { id: email.id },
      data: { status: "failed", errorReason: reason.slice(0, 500) },
    });
    // A mano, quien escribe ya ve el error en pantalla: la nota es para lo automático.
    if (failed.automated) await this.note(failed, `no se pudo enviar el correo «${failed.subject}» a ${failed.toAddress}: ${reason}`);
    return failed;
  }

  /**
   * Nota interna en el chat del contacto. La firma quien lo envió; lo
   * automático va a nombre del primer administrador, con su origen delante.
   */
  private async note(email: Email, text: string): Promise<void> {
    if (!email.conversationId) return;
    try {
      const authorId =
        email.userId ??
        (
          (await this.prisma.user.findFirst({ where: { orgId: email.orgId, role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
          (await this.prisma.user.findFirst({ where: { orgId: email.orgId }, orderBy: { createdAt: "asc" }, select: { id: true } }))
        )?.id;
      if (!authorId) return;
      const body = email.origin ? `✉️ ${email.origin}: ${text}` : `✉️ ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
      await this.prisma.note.create({ data: { conversationId: email.conversationId, authorId, body } });
    } catch (e) {
      this.logger.warn(`No se pudo dejar la nota del correo ${email.id}: ${(e as Error).message}`);
    }
  }

  private async toDtos(rows: Email[]): Promise<EmailDto[]> {
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name ?? u.email]));
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      body: r.bodyText,
      from: r.fromAddress,
      to: r.toAddress,
      status: r.status as EmailStatus,
      error: r.errorReason,
      automated: r.automated,
      sentBy: r.userId ? (names.get(r.userId) ?? null) : r.origin,
      attachments: readAttachments(r.attachments).map((a) => ({ name: a.name, size: a.size })),
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
    }));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
