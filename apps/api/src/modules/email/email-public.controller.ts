import { Controller, Get, Header, HttpCode, Post, Query } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg } from "../../infra/tenant/tenant.context";
import { readUnsubscribeToken } from "./email-unsubscribe";
import { EmailService } from "./email.service";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>body{margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2430}main{max-width:440px;margin:12vh auto 0;padding:32px 28px;background:#fff;border:1px solid #dfe2e8}h1{margin:0 0 12px;font-size:20px}p{margin:0 0 20px;font-size:15px;line-height:1.55;color:#454b5a}button{padding:12px 18px;border:0;background:#1f2430;color:#fff;font-size:15px;cursor:pointer}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

/**
 * Página pública de baja de los correos automáticos. No hay sesión: quien
 * llega trae un enlace firmado con su empresa y su dirección.
 *
 * Abrir el enlace solo pregunta; la baja se apunta al confirmar (POST). Los
 * filtros de correo abren los enlaces por su cuenta y, si bastara con abrirlo,
 * darían de baja a la gente sin que lo pidiera. El POST es también el que usa
 * el botón «Cancelar suscripción» de Gmail y compañía (RFC 8058).
 */
@Controller("email/unsubscribe")
export class EmailPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailService,
  ) {}

  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async ask(@Query("t") token?: string): Promise<string> {
    const who = readUnsubscribeToken(token);
    if (!who) return page("Enlace no válido", "<p>Este enlace de baja no es válido o está incompleto.</p>");
    const org = await this.orgName(who.orgId);
    return page(
      "¿Dejar de recibir estos correos?",
      `<p>Dejarás de recibir los correos automáticos de ${esc(org)} en <strong>${esc(who.address)}</strong>.</p><form method="post" action="?t=${encodeURIComponent(token!)}"><button type="submit">Sí, darme de baja</button></form>`,
    );
  }

  @Post()
  @HttpCode(200)
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async confirm(@Query("t") token?: string): Promise<string> {
    const who = readUnsubscribeToken(token);
    if (!who) return page("Enlace no válido", "<p>Este enlace de baja no es válido o está incompleto.</p>");
    // Sin sesión no hay empresa en contexto: la pone el propio enlace, que va firmado.
    await runInOrg(who.orgId, () => this.emails.unsubscribe(who.orgId, who.address));
    const org = await this.orgName(who.orgId);
    return page("Listo", `<p>${esc(who.address)} ya no recibirá correos automáticos de ${esc(org)}.</p>`);
  }

  private async orgName(orgId: string): Promise<string> {
    const org = await runInOrg(orgId, () => this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }));
    return org?.name ?? "esta empresa";
  }
}
