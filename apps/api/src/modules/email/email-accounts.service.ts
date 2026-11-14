import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EmailAccount, Prisma } from "@prisma/client";
import {
  EMAIL_ACCOUNT_ASSIGNEE,
  EMAIL_ACCOUNT_DEFAULT,
  emailTextToHtml,
  type AccessTokenClaims,
  type EmailAccountDto,
  type EmailAccountInput,
  type EmailProvider,
  type UpdateEmailAccountInput,
} from "@crm/shared";
import { decryptSecret, encryptSecret } from "../../common/utils/secret-box";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { EMAIL_TRANSPORT, SmtpError, type EmailTransport, type SmtpAccount } from "./email.transport";
import { smtpTargetProblem } from "./smtp-guard";

const WITH_OWNER = { user: { select: { id: true, name: true, email: true } } } satisfies Prisma.EmailAccountInclude;
type AccountRow = Prisma.EmailAccountGetPayload<{ include: typeof WITH_OWNER }>;

/** Lo que cada proveedor suele necesitar cuando rechaza el acceso. */
const AUTH_HINT: Record<EmailProvider, string> = {
  gmail: " En Gmail va una contraseña de aplicación (con la verificación en dos pasos activada), no tu contraseña normal.",
  outlook: " En Microsoft 365, el administrador tiene que activar el SMTP autenticado para este buzón.",
  smtp: "",
};

/** Inicio del día en curso (UTC): desde ahí se cuenta el tope diario de un buzón. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Buzones de la empresa. Cada uno es una dirección real con su servidor de
 * salida; la contraseña se guarda cifrada y no vuelve a salir por la API.
 * Compartido (sin dueño) lo usa todo el equipo y las automatizaciones;
 * personal, solo su dueño.
 */
@Injectable()
export class EmailAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {}

  /** Un administrador ve todos (los gestiona); el resto, los que puede usar. */
  async list(user: AccessTokenClaims): Promise<EmailAccountDto[]> {
    return user.role === "ADMIN" ? this.toDtos(await this.rows({})) : this.usableBy(user.sub);
  }

  /** Buzones desde los que esta persona puede escribir: los compartidos y los suyos. */
  async usableBy(userId: string): Promise<EmailAccountDto[]> {
    return this.toDtos(await this.rows({ OR: [{ userId: null }, { userId }] }));
  }

  async create(input: EmailAccountInput): Promise<EmailAccountDto> {
    const smtp: SmtpAccount = { host: input.smtpHost, port: input.smtpPort, user: input.smtpUser, pass: cleanPass(input.provider, input.smtpPass) };
    await this.assertOwner(input.userId);
    await this.verify(smtp, input.provider);
    try {
      const row = await this.prisma.emailAccount.create({
        data: {
          orgId: this.tenant.orgId(),
          userId: input.userId,
          address: input.address,
          fromName: input.fromName || null,
          provider: input.provider,
          smtpHost: smtp.host,
          smtpPort: smtp.port,
          smtpUser: smtp.user,
          smtpPassEnc: encryptSecret(smtp.pass),
          signature: input.signature.trim() || null,
          dailyLimit: input.dailyLimit,
          verifiedAt: new Date(),
        },
        include: WITH_OWNER,
      });
      return (await this.toDtos([row]))[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException("Ese buzón ya está conectado");
      throw e;
    }
  }

  async update(id: string, input: UpdateEmailAccountInput): Promise<EmailAccountDto> {
    const existing = await this.prisma.emailAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Buzón no encontrado");
    const provider = (input.provider ?? existing.provider) as EmailProvider;
    if (input.userId !== undefined) await this.assertOwner(input.userId);

    // La conexión solo se vuelve a comprobar si cambió algo de ella.
    const touchesSmtp =
      !!input.smtpPass ||
      (input.smtpHost !== undefined && input.smtpHost !== existing.smtpHost) ||
      (input.smtpPort !== undefined && input.smtpPort !== existing.smtpPort) ||
      (input.smtpUser !== undefined && input.smtpUser !== existing.smtpUser);
    let pass: string | null = null;
    if (touchesSmtp) {
      pass = input.smtpPass ? cleanPass(provider, input.smtpPass) : decryptSecret(existing.smtpPassEnc);
      if (!pass) throw new BadRequestException("Vuelve a escribir la contraseña del buzón para guardar el cambio");
      await this.verify(
        { host: input.smtpHost ?? existing.smtpHost, port: input.smtpPort ?? existing.smtpPort, user: input.smtpUser ?? existing.smtpUser, pass },
        provider,
      );
    }
    try {
      const row = await this.prisma.emailAccount.update({
        where: { id },
        data: {
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.fromName !== undefined ? { fromName: input.fromName || null } : {}),
          ...(input.provider !== undefined ? { provider: input.provider } : {}),
          ...(input.smtpHost !== undefined ? { smtpHost: input.smtpHost } : {}),
          ...(input.smtpPort !== undefined ? { smtpPort: input.smtpPort } : {}),
          ...(input.smtpUser !== undefined ? { smtpUser: input.smtpUser } : {}),
          ...(input.smtpPass ? { smtpPassEnc: encryptSecret(pass!) } : {}),
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          ...(input.signature !== undefined ? { signature: input.signature.trim() || null } : {}),
          ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
          ...(touchesSmtp ? { status: "ok", lastError: null, verifiedAt: new Date() } : {}),
        },
        include: WITH_OWNER,
      });
      return (await this.toDtos([row]))[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException("Ese buzón ya está conectado");
      throw e;
    }
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.emailAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Buzón no encontrado");
    await this.prisma.emailAccount.delete({ where: { id } });
    return { ok: true };
  }

  /** Correo de prueba al propio buzón: se ve llegar y confirma el camino completo. */
  async sendTest(id: string): Promise<{ ok: true; to: string }> {
    const row = await this.prisma.emailAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Buzón no encontrado");
    const text = "Este buzón quedó conectado a Driony.\n\nSi lees este mensaje, los correos que envíes desde el CRM saldrán por esta dirección.";
    try {
      await this.transport.send(this.credentials(row), {
        from: { name: row.fromName ?? row.address, address: row.address },
        to: row.address,
        subject: "Prueba de envío desde Driony",
        text,
        html: emailTextToHtml(text),
        attachments: [],
      });
    } catch (e) {
      await this.markResult(row.id, e as Error);
      throw new BadRequestException(this.readable(e, row.provider as EmailProvider));
    }
    await this.markResult(row.id, null);
    return { ok: true, to: row.address };
  }

  /** Buzón que una persona puede usar para escribir, o un error legible. */
  async forUser(id: string, userId: string): Promise<EmailAccount> {
    const row = await this.prisma.emailAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Buzón no encontrado");
    if (row.userId && row.userId !== userId) throw new BadRequestException("Ese buzón es personal de otra persona del equipo");
    return row;
  }

  /**
   * Buzón de un envío automático. Uno concreto si se eligió y sigue existiendo;
   * «el del responsable» es el personal de quien lleva el chat. En los dos casos,
   * si no lo hay, sale por el compartido más antiguo: el de la empresa.
   */
  async forAutomation(choice: string | undefined, assignedAgentId: string | null): Promise<EmailAccount | null> {
    if (choice && choice !== EMAIL_ACCOUNT_DEFAULT && choice !== EMAIL_ACCOUNT_ASSIGNEE) {
      const picked = await this.prisma.emailAccount.findUnique({ where: { id: choice } });
      if (picked) return picked;
    }
    if (choice === EMAIL_ACCOUNT_ASSIGNEE && assignedAgentId) {
      const own = await this.prisma.emailAccount.findFirst({ where: { userId: assignedAgentId }, orderBy: { createdAt: "asc" } });
      if (own) return own;
    }
    return this.prisma.emailAccount.findFirst({ where: { userId: null }, orderBy: { createdAt: "asc" } });
  }

  /** Cuántos correos lleva hoy un buzón (los que salieron y los que esperan salir). */
  sentToday(accountId: string): Promise<number> {
    return this.prisma.email.count({
      where: { accountId, createdAt: { gte: startOfUtcDay() }, status: { in: ["queued", "sent"] } },
    });
  }

  credentials(row: Pick<EmailAccount, "smtpHost" | "smtpPort" | "smtpUser" | "smtpPassEnc">): SmtpAccount {
    const pass = decryptSecret(row.smtpPassEnc);
    if (!pass) throw new SmtpError("No se pudo leer la contraseña guardada del buzón: vuelve a escribirla en Ajustes › Correo.", false, true);
    return { host: row.smtpHost, port: row.smtpPort, user: row.smtpUser, pass };
  }

  /** Deja constancia de cómo fue el último envío: lo enseña Ajustes › Correo. */
  async markResult(id: string, error: Error | null): Promise<void> {
    const auth = error instanceof SmtpError && error.auth;
    await this.prisma.emailAccount
      .update({
        where: { id },
        data: error
          ? { lastError: error.message.slice(0, 300), ...(auth ? { status: "error" } : {}) }
          : { status: "ok", lastError: null, lastSentAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** El motivo de un fallo, con la pista del proveedor si el problema es el acceso. */
  readable(e: unknown, provider: EmailProvider): string {
    const err = e as Error;
    return err instanceof SmtpError && err.auth ? `${err.message}${AUTH_HINT[provider] ?? ""}` : err.message;
  }

  private async verify(smtp: SmtpAccount, provider: EmailProvider): Promise<void> {
    const problem = smtpTargetProblem(smtp.host, smtp.port);
    if (problem) throw new BadRequestException(`Servidor de correo no admitido: ${problem}.`);
    try {
      await this.transport.verify(smtp);
    } catch (e) {
      throw new BadRequestException(this.readable(e, provider));
    }
  }

  private async assertOwner(userId: string | null): Promise<void> {
    if (!userId) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BadRequestException("Esa persona no es de tu equipo");
  }

  private rows(where: Prisma.EmailAccountWhereInput): Promise<AccountRow[]> {
    return this.prisma.emailAccount.findMany({ where, include: WITH_OWNER, orderBy: [{ userId: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }] });
  }

  private async toDtos(rows: AccountRow[]): Promise<EmailAccountDto[]> {
    if (!rows.length) return [];
    const counts = await this.prisma.email.groupBy({
      by: ["accountId"],
      where: { accountId: { in: rows.map((r) => r.id) }, createdAt: { gte: startOfUtcDay() }, status: { in: ["queued", "sent"] } },
      _count: { _all: true },
    });
    const today = new Map(counts.map((c) => [c.accountId, c._count._all]));
    return rows.map((r) => ({
      id: r.id,
      address: r.address,
      fromName: r.fromName ?? "",
      provider: r.provider as EmailProvider,
      smtpHost: r.smtpHost,
      smtpPort: r.smtpPort,
      smtpUser: r.smtpUser,
      owner: r.user ? { id: r.user.id, name: r.user.name ?? r.user.email } : null,
      signature: r.signature ?? "",
      dailyLimit: r.dailyLimit,
      sentToday: today.get(r.id) ?? 0,
      status: r.status === "error" ? "error" : "ok",
      lastError: r.lastError,
      lastSentAt: r.lastSentAt?.toISOString() ?? null,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
    }));
  }
}

/** Google enseña la contraseña de aplicación en grupos de cuatro: los espacios no son parte de ella. */
function cleanPass(provider: EmailProvider, pass: string): string {
  return provider === "gmail" ? pass.replace(/\s+/g, "") : pass;
}
