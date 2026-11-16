import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as bcrypt from "bcryptjs";
import {
  PASSWORD_RESET_EMAIL_MINUTES,
  PASSWORD_RESET_LINK_HOURS,
  type ForgotPasswordInput,
  type PasswordResetCheck,
  type PasswordResetDone,
  type PasswordResetLink,
  type PasswordResetOptions,
} from "@crm/shared";
import { env } from "../../common/utils/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped, tenancyMode } from "../../infra/tenant/tenant.context";
import { OrganizationService } from "../organizations/organization.service";
import { SystemMailer } from "./system-mailer";

type Via = "email" | "admin" | "platform";
type Locale = "es" | "en";

/** Correos por persona y hora: suficiente para quien no lo encuentra, poco para molestar a alguien. */
const MAX_PER_EMAIL_HOUR = 3;
/** Correos por empresa cada 15 minutos: frena que alguien recorra la lista de correos de una empresa. */
const MAX_PER_ORG_15MIN = 20;

const GONE = "Este enlace ya no sirve: caducó, ya se usó o se pidió otro después. Pide uno nuevo.";

/**
 * Recuperar la contraseña, por tres caminos que acaban en el mismo enlace:
 *
 * - **Por correo** («¿Olvidaste tu contraseña?»): la persona escribe su correo
 *   en el acceso de su empresa y le llega un enlace de 30 minutos. La respuesta
 *   es siempre la misma, exista o no la cuenta: si no, el formulario serviría
 *   para averiguar quién trabaja en cada empresa.
 * - **Por su administrador** (Vendedores): genera un enlace de 24 horas
 *   y se lo manda por WhatsApp. No necesita correo.
 * - **Por el operador** (consola de plataforma): lo mismo, para cuando quien
 *   olvidó la contraseña es el único administrador. Queda en el diario.
 *
 * El enlace sirve una vez; uno nuevo anula los anteriores de esa persona; al
 * usarlo se cierran todas sus sesiones. Se guarda el hash, nunca el enlace.
 *
 * Límite de intentos: por correo y por empresa, no por IP. La petición llega
 * desde el servidor de la web (BFF), así que la API ve siempre la misma IP.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger("PasswordReset");
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly orgs: OrganizationService,
    private readonly mailer: SystemMailer,
  ) {}

  options(): PasswordResetOptions {
    return { email: this.mailer.enabled() };
  }

  // ── Por correo ──────────────────────────────────────────────
  /** Pide el enlace por correo. No dice nunca si la cuenta existe. */
  async requestByEmail(input: ForgotPasswordInput): Promise<void> {
    if (tenancyMode === "multi" && !input.orgSlug) {
      throw new BadRequestException("Indica la dirección de tu empresa (subdominio)");
    }
    // Sin correo del sistema no hay nada que mandar; la pantalla ya lo dice.
    if (!this.mailer.enabled()) return;

    const email = input.email.toLowerCase().trim();
    const org = input.orgSlug ? await this.orgs.resolveSlug(input.orgSlug) : await this.singleOrg();
    if (!org) return;
    if (!this.allow(`mail:${org.id}:${email}`, MAX_PER_EMAIL_HOUR, 60 * 60_000)) return;
    if (!this.allow(`org:${org.id}`, MAX_PER_ORG_15MIN, 15 * 60_000)) return;

    const user = await runUnscoped("recuperar contraseña: buscar usuario por correo", () =>
      this.prisma.user.findUnique({
        where: { orgId_email: { orgId: org.id, email } },
        select: { id: true, email: true, name: true, isActive: true },
      }),
    );
    if (!user || !user.isActive) return;

    const slug = await this.slugOf(org.id);
    const { raw } = await this.issue(org.id, user.id, "email", null, PASSWORD_RESET_EMAIL_MINUTES * 60_000);
    const url = this.resetUrl(slug, raw);
    const mail = resetEmail(input.locale ?? "es", { name: user.name, email: user.email, orgName: org.name, url });
    // Sin esperar al SMTP: así tarda lo mismo exista o no la cuenta, y un
    // servidor de correo lento no deja colgada la pantalla.
    void this.mailer.send({ to: user.email, ...mail }).catch((e: Error) =>
      this.logger.warn(`No se pudo enviar el enlace para cambiar la contraseña: ${e.message}`),
    );
  }

  // ── Por un administrador o el operador ──────────────────────
  /**
   * Enlace de 24 horas para una persona de la empresa. `orgId` es la empresa
   * de quien lo pide (el administrador) o la que eligió el operador: la
   * persona tiene que ser de esa empresa.
   */
  async linkFor(orgId: string, userId: string, via: Exclude<Via, "email">, createdBy: string): Promise<PasswordResetLink> {
    const user = await runInOrg(orgId, () =>
      this.prisma.user.findFirst({ where: { id: userId, orgId }, select: { id: true, email: true, isActive: true } }),
    );
    if (!user) throw new NotFoundException("Usuario no encontrado");
    if (!user.isActive) throw new BadRequestException("Está desactivado: reactívalo antes de darle un enlace.");
    const slug = await this.slugOf(orgId);
    const { raw, expiresAt } = await this.issue(orgId, user.id, via, createdBy, PASSWORD_RESET_LINK_HOURS * 60 * 60_000);
    this.logger.log(`Enlace para cambiar la contraseña de ${user.email} (${via}, por ${createdBy})`);
    return { url: this.resetUrl(slug, raw), email: user.email, expiresAt: expiresAt.toISOString() };
  }

  /** Lo mismo desde una petición de empresa: la empresa sale del token del administrador. */
  linkForTeamMember(userId: string, adminId: string): Promise<PasswordResetLink> {
    return this.linkFor(this.tenant.orgId(), userId, "admin", adminId);
  }

  // ── Canjear el enlace ───────────────────────────────────────
  /** Para la pantalla del enlace: de quién es, antes de pedir la contraseña. */
  async check(rawToken: string): Promise<PasswordResetCheck> {
    const row = await this.find(rawToken);
    return { email: row.user.email, orgName: row.org.name, expiresAt: row.expiresAt.toISOString() };
  }

  /** Pone la contraseña nueva, gasta el enlace y cierra todas las sesiones de esa persona. */
  async reset(rawToken: string, password: string, locale: Locale = "es"): Promise<PasswordResetDone> {
    const row = await this.find(rawToken);
    const passwordHash = await bcrypt.hash(password, 10);

    await runInOrg(row.orgId, () =>
      this.prisma.$transaction(async (tx) => {
        // Se reclama con una condición: dos envíos a la vez no cambian dos veces.
        const claimed = await tx.passwordReset.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw new GoneException(GONE);
        await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
        // Los demás enlaces vivos de esa persona ya no tienen sentido.
        await tx.passwordReset.deleteMany({ where: { userId: row.userId, usedAt: null } });
      }),
    );

    // Quien tuviera la cuenta abierta con la contraseña vieja queda fuera.
    await runInOrg(row.orgId, async () => {
      const now = new Date();
      const sessions = await this.prisma.session.findMany({ where: { userId: row.userId, revokedAt: null }, select: { id: true } });
      const ids = sessions.map((s) => s.id);
      if (ids.length) {
        await this.prisma.$transaction([
          this.prisma.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: now } }),
          this.prisma.refreshToken.updateMany({ where: { sessionId: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
        ]);
      }
    });

    if (this.mailer.enabled()) {
      const mail = changedEmail(locale, { name: row.user.name, email: row.user.email, orgName: row.org.name });
      void this.mailer.send({ to: row.user.email, ...mail }).catch((e: Error) =>
        this.logger.warn(`No se pudo avisar del cambio de contraseña: ${e.message}`),
      );
    }
    this.logger.log(`Contraseña cambiada con un enlace (${row.via}) para ${row.user.email}`);
    return { email: row.user.email, orgSlug: row.org.slug };
  }

  // ── Internos ────────────────────────────────────────────────
  private async find(rawToken: string) {
    // Aún no se sabe de qué empresa es: el enlace es justo lo que lo dice.
    const row = await runUnscoped("recuperar contraseña: canjear enlace", () =>
      this.prisma.passwordReset.findUnique({
        where: { tokenHash: hash(rawToken) },
        include: {
          user: { select: { email: true, name: true, isActive: true } },
          org: { select: { name: true, slug: true, isActive: true } },
        },
      }),
    );
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || !row.user.isActive || !row.org.isActive) {
      throw new GoneException(GONE);
    }
    return row;
  }

  private async issue(orgId: string, userId: string, via: Via, createdBy: string | null, ttlMs: number) {
    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlMs);
    await runInOrg(orgId, () =>
      this.prisma.$transaction([
        // Un enlace vivo por persona: el nuevo anula los anteriores.
        this.prisma.passwordReset.deleteMany({ where: { userId, usedAt: null } }),
        this.prisma.passwordReset.create({ data: { orgId, userId, tokenHash: hash(raw), via, createdBy, expiresAt } }),
      ]),
    );
    return { raw, expiresAt };
  }

  /** La empresa única de una instalación propia. */
  private async singleOrg(): Promise<{ id: string; name: string } | null> {
    const id = this.tenant.orgId();
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
    return org?.isActive ? { id: org.id, name: org.name } : null;
  }

  private async slugOf(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
    return org?.slug ?? "";
  }

  /** El panel de la empresa: su subdominio en el SaaS, o la web configurada en una instalación propia. */
  private resetUrl(slug: string, raw: string): string {
    const base = env("SAAS_BASE_DOMAIN");
    const web = base
      ? `${base.startsWith("localhost") ? "http" : "https"}://${slug}.${base}`
      : (env("WEB_PUBLIC_URL") ?? env("WEB_ORIGIN") ?? "http://localhost:3000").replace(/\/+$/, "");
    return `${web}/login/reset?token=${encodeURIComponent(raw)}`;
  }

  private allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    if (this.hits.size > 5_000) {
      for (const [k, list] of this.hits) if (!list.some((t) => now - t < 60 * 60_000)) this.hits.delete(k);
    }
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Párrafos, el enlace como botón (con la dirección debajo, por si el botón no se ve) y lo que va después. */
function htmlOf(before: string[], link?: { url: string; label: string }, after: string[] = []): string {
  const p = (t: string) => `<p style="margin:0 0 14px">${escapeHtml(t)}</p>`;
  const button = link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(link.url)}" style="display:inline-block;background:#e2f80d;color:#0b0d10;padding:11px 18px;text-decoration:none;font-weight:600">${escapeHtml(link.label)}</a></p><p style="margin:0 0 14px;color:#666;font-size:13px;word-break:break-all">${escapeHtml(link.url)}</p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${before.map(p).join("")}${button}${after.map(p).join("")}</div>`;
}

function resetEmail(locale: Locale, d: { name: string | null; email: string; orgName: string; url: string }) {
  const minutes = PASSWORD_RESET_EMAIL_MINUTES;
  if (locale === "en") {
    const lines = [
      `Hi${d.name ? ` ${d.name}` : ""},`,
      `Someone (probably you) asked to change the password of ${d.email} at ${d.orgName}.`,
      `To choose a new one, open this link. It works for ${minutes} minutes and only once.`,
    ];
    const after = "If you didn't ask for it, ignore this email: your password stays the same.";
    return {
      subject: "Choose a new password for Driony",
      text: `${lines.join("\n\n")}\n\n${d.url}\n\n${after}`,
      html: htmlOf(lines, { url: d.url, label: "Choose a new password" }, [after]),
    };
  }
  const lines = [
    `Hola${d.name ? ` ${d.name}` : ""}:`,
    `Alguien (seguramente tú) pidió cambiar la contraseña de ${d.email} en ${d.orgName}.`,
    `Para elegir una nueva, abre este enlace. Vale ${minutes} minutos y sirve una sola vez.`,
  ];
  const after = "Si no lo pediste, ignora este correo: tu contraseña sigue igual.";
  return {
    subject: "Elige una contraseña nueva para Driony",
    text: `${lines.join("\n\n")}\n\n${d.url}\n\n${after}`,
    html: htmlOf(lines, { url: d.url, label: "Elegir contraseña nueva" }, [after]),
  };
}

function changedEmail(locale: Locale, d: { name: string | null; email: string; orgName: string }) {
  if (locale === "en") {
    const lines = [
      `Hi${d.name ? ` ${d.name}` : ""},`,
      `The password of ${d.email} at ${d.orgName} was just changed, and every device signed in with the old one was signed out.`,
      "If it wasn't you, tell whoever manages your company's account right away.",
    ];
    return { subject: "Your Driony password was changed", text: lines.join("\n\n"), html: htmlOf(lines) };
  }
  const lines = [
    `Hola${d.name ? ` ${d.name}` : ""}:`,
    `Se acaba de cambiar la contraseña de ${d.email} en ${d.orgName}, y se cerró la sesión en todos los dispositivos que entraban con la anterior.`,
    "Si no fuiste tú, avísale enseguida a quien administra tu empresa.",
  ];
  return { subject: "Se cambió tu contraseña de Driony", text: lines.join("\n\n"), html: htmlOf(lines) };
}
