import { Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { env } from "../../common/utils/env";
import { tenancyMode } from "../../infra/tenant/tenant.context";
import { resolveSmtpHost, smtpTargetProblem } from "./smtp-guard";

/** Con qué se entra al servidor de salida de un buzón. */
export interface SmtpAccount {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface OutgoingEmail {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
  headers?: Record<string, string>;
}

/**
 * Por qué falló un envío, en palabras para quien lo configura.
 * `retryable`: el fallo puede ser pasajero (red, servidor ocupado) y merece
 * otro intento; `auth`: el servidor rechazó el acceso al buzón.
 */
export class SmtpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly auth = false,
  ) {
    super(message);
  }
}

export const EMAIL_TRANSPORT = Symbol("EMAIL_TRANSPORT");

/** Envío de correo. La lógica depende de esta interfaz; las pruebas ponen una de mentira. */
export interface EmailTransport {
  /** Comprueba que el servidor acepta el usuario y la contraseña. */
  verify(account: SmtpAccount): Promise<void>;
  send(account: SmtpAccount, mail: OutgoingEmail): Promise<{ messageId: string }>;
}

interface MailerError extends Error {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
}

@Injectable()
export class SmtpEmailTransport implements EmailTransport {
  async verify(account: SmtpAccount): Promise<void> {
    const t = await this.open(account);
    try {
      await t.verify();
    } catch (e) {
      throw this.explain(e as MailerError, account);
    } finally {
      t.close();
    }
  }

  async send(account: SmtpAccount, mail: OutgoingEmail): Promise<{ messageId: string }> {
    const t = await this.open(account);
    try {
      const info = await t.sendMail({
        from: { name: mail.from.name, address: mail.from.address },
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
        headers: mail.headers,
      });
      return { messageId: String(info.messageId ?? "") };
    } catch (e) {
      throw this.explain(e as MailerError, account);
    } finally {
      t.close();
    }
  }

  /**
   * Una conexión por envío, siempre cifrada: TLS directo en el 465 y STARTTLS
   * obligatorio en el resto. Solo una instalación propia puede relajarlo
   * (EMAIL_SMTP_ALLOW_INSECURE=true) para un relay interno sin certificado.
   */
  private async open(a: SmtpAccount): Promise<Transporter> {
    const problem = smtpTargetProblem(a.host, a.port);
    if (problem) throw new SmtpError(`Servidor de correo no admitido: ${problem}.`, false);
    let address: string;
    try {
      address = await resolveSmtpHost(a.host);
    } catch (e) {
      throw new SmtpError(`Servidor de correo no admitido: ${(e as Error).message}.`, false);
    }
    const secure = a.port === 465;
    const relaxed = tenancyMode !== "multi" && env("EMAIL_SMTP_ALLOW_INSECURE") === "true";
    return createTransport({
      host: address,
      port: a.port,
      secure,
      requireTLS: !secure && !relaxed,
      auth: { user: a.user, pass: a.pass },
      tls: { servername: a.host, ...(relaxed ? { rejectUnauthorized: false } : {}) },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      // Los adjuntos van siempre como contenido: nunca se lee una ruta ni una URL.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  private explain(e: MailerError, a: SmtpAccount): SmtpError {
    const where = `${a.host}:${a.port}`;
    const code = e.code ?? "";
    const status = e.responseCode ?? 0;
    if (code === "EAUTH" || status === 535 || status === 534) {
      return new SmtpError("El servidor de correo rechazó el usuario o la contraseña.", false, true);
    }
    if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "EDNS" || code === "ECONNREFUSED" || code === "ECONNRESET") {
      if (/certificate|self.signed|altnames/i.test(e.message)) {
        return new SmtpError(`El certificado de seguridad de ${a.host} no es válido.`, false);
      }
      return new SmtpError(`No se pudo conectar con ${where}. Revisa el servidor y el puerto.`, true);
    }
    if (code === "ETLS" || /STARTTLS/i.test(e.message)) {
      return new SmtpError(`El servidor ${where} no ofrece conexión cifrada, y sin ella no se envía.`, false);
    }
    const said = (e.response ?? e.message ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    // 4xx: el servidor pide reintentar más tarde. 5xx: lo rechazó (dirección, tamaño, política).
    if (status >= 400 && status < 500) return new SmtpError(`El servidor de correo pidió reintentar más tarde: ${said}`, true);
    if (code === "EENVELOPE" || status >= 500) return new SmtpError(`El servidor de correo rechazó el envío: ${said}`, false);
    return new SmtpError(`No se pudo enviar el correo: ${said || "error desconocido"}`, false);
  }
}
