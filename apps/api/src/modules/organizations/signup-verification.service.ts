import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  SIGNUP_CODE_LENGTH,
  SIGNUP_CODE_MINUTES,
  SIGNUP_CODE_RESEND_SECONDS,
  type SignupCodeRequest,
  type SignupCodeSent,
  type SignupOptions,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { env } from "../../common/utils/env";
import { SystemMailer } from "../auth/system-mailer";
import { signupCodeEmail } from "./signup-code-email";

/** Intentos con un mismo código. Con 6 cifras, cinco intentos dan 1 entre 200.000. */
export const SIGNUP_CODE_MAX_ATTEMPTS = 5;
/** Códigos por correo y hora: suficiente para quien no lo encuentra, poco para molestar a alguien. */
const MAX_PER_EMAIL_HOUR = 5;
/** Códigos en total cada 15 minutos: frena que un script use el alta para mandar correos a cualquiera. */
const MAX_ALL_15MIN = 200;

const GONE = "Ese código ya no sirve: caducó o se pidió otro después. Pide uno nuevo.";
const WRONG = "El código no es correcto. Revisa el último correo que te llegó.";
const SPENT = "Demasiados intentos con este código. Pide uno nuevo.";

/**
 * Confirmar el correo al dar de alta una empresa.
 *
 * Antes de crear nada, le llega a quien se registra un código de 6 cifras al
 * correo que escribió, y el alta no sigue sin él. Así nadie crea una empresa a
 * nombre de un correo que no es suyo (el de un competidor, el de su jefe) ni
 * con uno inventado que luego no sirve para recuperar la contraseña.
 *
 * Por qué antes y no después de crear la empresa: si se confirmara después,
 * el subdominio ya estaría ocupado por alguien que quizá nunca confirme, y
 * habría que dejar entrar a medias y vigilar en cada pantalla quién falta.
 *
 * - Un código vivo por correo: el nuevo sustituye al anterior.
 * - Vale {@link SIGNUP_CODE_MINUTES} minutos y {@link SIGNUP_CODE_MAX_ATTEMPTS} intentos.
 * - Se guarda su HMAC con la clave del servidor, no el código: con una copia de
 *   la base no basta para probar el millón de combinaciones.
 * - Se gasta al crear la empresa, no al comprobarlo: si el subdominio se lo
 *   lleva otro mientras tanto, el mismo código sirve para reintentar.
 *
 * Sin correo del sistema (MAIL_SMTP_HOST) no hay cómo mandarlo y el alta sigue
 * sin este paso, como «¿Olvidaste tu contraseña?».
 *
 * Límite de envíos: por correo y en total, no por IP. La petición llega desde
 * el servidor de la web (BFF), así que la API ve siempre la misma IP.
 */
@Injectable()
export class SignupVerificationService {
  private readonly logger = new Logger("SignupVerification");
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: SystemMailer,
  ) {}

  /** ¿Pide el alta el código? Solo si hay correo del sistema con el que mandarlo. */
  enabled(): boolean {
    return this.mailer.enabled();
  }

  options(): SignupOptions {
    return { emailCode: this.enabled() };
  }

  /** Manda un código nuevo al correo. A diferencia de la contraseña, aquí no hay cuenta que ocultar. */
  async request(input: SignupCodeRequest): Promise<SignupCodeSent> {
    if (!this.enabled()) {
      throw new BadRequestException("Este servidor no manda correos: el alta no necesita código.");
    }
    const email = normalizeEmail(input.email);
    const now = Date.now();

    const current = await this.prisma.signupVerification.findUnique({ where: { email }, select: { sentAt: true } });
    if (current) {
      const wait = Math.ceil((current.sentAt.getTime() + SIGNUP_CODE_RESEND_SECONDS * 1000 - now) / 1000);
      if (wait > 0) {
        throw new HttpException(`Espera ${wait} s antes de pedir otro código.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    if (!this.allow(`mail:${email}`, MAX_PER_EMAIL_HOUR, 60 * 60_000)) {
      throw new HttpException(
        "Ya te mandamos varios códigos a este correo. Revisa la carpeta de spam o inténtalo dentro de una hora.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.allow("all", MAX_ALL_15MIN, 15 * 60_000)) {
      throw new HttpException("Hay demasiadas altas en este momento. Inténtalo en unos minutos.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = newCode();
    const codeHash = hashCode(email, code);
    const sentAt = new Date(now);
    const expiresAt = new Date(now + SIGNUP_CODE_MINUTES * 60_000);
    await this.prisma.signupVerification.upsert({
      where: { email },
      create: { email, codeHash, expiresAt, sentAt },
      update: { codeHash, attempts: 0, expiresAt, sentAt },
    });

    // Esperando al SMTP, al revés que la contraseña: aquí quien espera tiene
    // que saber si el correo salió, porque sin él no puede seguir.
    try {
      await this.mailer.send({ to: email, ...signupCodeEmail(input.locale ?? "es", { email, code }) });
    } catch (e) {
      this.logger.warn(`No se pudo enviar el código del alta: ${(e as Error).message}`);
      // Sin correo no hay código que esperar: que pueda pedir otro ya.
      await this.prisma.signupVerification.deleteMany({ where: { email, codeHash } }).catch(() => undefined);
      throw new ServiceUnavailableException("No pudimos enviar el correo. Revisa la dirección o inténtalo en un momento.");
    }

    // Limpieza de paso: los códigos que caducaron hace más de un día ya no los mira nadie.
    void this.prisma.signupVerification
      .deleteMany({ where: { expiresAt: { lt: new Date(now - 24 * 60 * 60_000) } } })
      .catch(() => undefined);

    return { email, expiresInMinutes: SIGNUP_CODE_MINUTES, resendInSeconds: SIGNUP_CODE_RESEND_SECONDS };
  }

  /**
   * Comprueba el código antes de crear la empresa. No lo gasta (eso lo hace
   * {@link consume} cuando el alta sale bien), pero cada fallo cuenta.
   *
   * Los errores llevan delante `emailCode: ` para que la web marque ese campo.
   */
  async verify(rawEmail: string, code: string | undefined): Promise<{ id: string }> {
    if (!code) throw new BadRequestException("emailCode: Escribe el código que te mandamos al correo.");
    const email = normalizeEmail(rawEmail);
    const row = await this.prisma.signupVerification.findUnique({ where: { email } });
    if (!row || row.expiresAt.getTime() <= Date.now()) throw new GoneException(`emailCode: ${GONE}`);
    if (row.attempts >= SIGNUP_CODE_MAX_ATTEMPTS) throw new GoneException(`emailCode: ${SPENT}`);

    if (!sameHash(row.codeHash, hashCode(email, code))) {
      // Se cuenta con una condición: dos intentos a la vez no se saltan el tope.
      await this.prisma.signupVerification.updateMany({
        where: { id: row.id, attempts: { lt: SIGNUP_CODE_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      const left = SIGNUP_CODE_MAX_ATTEMPTS - row.attempts - 1;
      if (left <= 0) throw new GoneException(`emailCode: ${SPENT}`);
      throw new BadRequestException(`emailCode: ${WRONG}`);
    }
    return { id: row.id };
  }

  /** Gasta el código: la empresa ya está creada. */
  async consume(id: string): Promise<void> {
    await this.prisma.signupVerification.deleteMany({ where: { id } });
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

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Seis cifras al azar con el generador criptográfico, con ceros a la izquierda. */
function newCode(): string {
  return randomInt(0, 10 ** SIGNUP_CODE_LENGTH).toString().padStart(SIGNUP_CODE_LENGTH, "0");
}

/** HMAC del código atado a su correo: el mismo código para otro correo da otro hash. */
export function hashCode(email: string, code: string): string {
  const source = env("APP_ENCRYPTION_KEY") ?? env("JWT_ACCESS_SECRET");
  if (!source) throw new Error("Falta APP_ENCRYPTION_KEY (o JWT_ACCESS_SECRET) para guardar los códigos del alta");
  const key = createHmac("sha256", source).update("driony.signup-code.v1").digest();
  return createHmac("sha256", key).update(`${normalizeEmail(email)}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
