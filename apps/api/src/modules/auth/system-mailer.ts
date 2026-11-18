import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { env } from "../../common/utils/env";

/** Un correo del sistema: siempre de Driony (o de quien opere la instalación), nunca de una empresa. */
export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Lo mínimo de nodemailer que se usa. Las pruebas ponen uno que guarda los correos. */
export interface SystemMailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

export const SYSTEM_MAIL_TRANSPORT = Symbol("SYSTEM_MAIL_TRANSPORT");

/**
 * Correos del sistema: el código que confirma el correo en el alta de empresa,
 * el enlace para elegir contraseña nueva y el aviso de que se cambió. Salen por el SMTP del `.env` (MAIL_SMTP_*), que pone quien
 * opera el servidor; no tienen nada que ver con los buzones de las empresas
 * (módulo de correo), que se configuran en la app.
 *
 * Sin `MAIL_SMTP_HOST` no hay correo del sistema y la pantalla de acceso lo
 * dice («pídele a quien administra tu empresa»): mejor eso que prometer un
 * correo que no va a llegar.
 *
 * Siempre cifrado: TLS directo en el 465 y STARTTLS obligatorio en el resto.
 * `MAIL_SMTP_INSECURE=true` lo relaja solo para un relay local sin certificado.
 */
@Injectable()
export class SystemMailer {
  private readonly logger = new Logger("SystemMailer");

  constructor(@Optional() @Inject(SYSTEM_MAIL_TRANSPORT) private readonly injected?: SystemMailTransport) {}

  /** ¿Hay correo del sistema en este servidor? */
  enabled(): boolean {
    return !!this.injected || !!env("MAIL_SMTP_HOST");
  }

  /** Remitente: MAIL_FROM («Driony <no-responder@driony.com>») o, si falta, el usuario del SMTP. */
  from(): string {
    return env("MAIL_FROM") ?? env("MAIL_SMTP_USER") ?? "no-reply@localhost";
  }

  async send(mail: SystemMail): Promise<void> {
    const transport = this.injected ?? this.open();
    if (!transport) throw new Error("No hay correo del sistema configurado (MAIL_SMTP_HOST)");
    await transport.sendMail({ from: this.from(), ...mail });
    this.logger.log(`Correo del sistema enviado: «${mail.subject}»`);
  }

  private open(): SystemMailTransport | null {
    const host = env("MAIL_SMTP_HOST");
    if (!host) return null;
    const port = Number(env("MAIL_SMTP_PORT") ?? 587);
    const secure = port === 465;
    const insecure = env("MAIL_SMTP_INSECURE") === "true";
    const user = env("MAIL_SMTP_USER");
    const pass = env("MAIL_SMTP_PASS");
    return createTransport({
      host,
      port,
      secure,
      requireTLS: !secure && !insecure,
      ...(user ? { auth: { user, pass: pass ?? "" } } : {}),
      ...(insecure ? { ignoreTLS: true } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}
