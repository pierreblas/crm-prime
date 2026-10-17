import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import type {
  AccessTokenClaims,
  AuthTokens,
  LoginInput,
  Platform,
  PublicUser,
  RegisterInput,
  Role,
} from "@crm/shared";
import { effectivePermissions } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { OrganizationService } from "../organizations/organization.service";
import { runUnscoped, tenancyMode } from "../../infra/tenant/tenant.context";

interface DeviceMeta {
  platform: Platform;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

interface AttemptRecord {
  count: number;
  firstAt: number;
}

@Injectable()
export class AuthService {
  private readonly accessTtl = process.env.JWT_ACCESS_TTL ?? "15m";
  private readonly refreshTtlDays = Number(process.env.REFRESH_TTL_DAYS ?? 30);
  // Ventana de tolerancia para refresh concurrentes. Si un token se rotó hace
  // pocos segundos y la sesión sigue viva, asumimos una carrera benigna (varias
  // pestañas / requests en paralelo al expirar el access token) en vez de robo.
  private readonly refreshGraceMs = Number(
    process.env.REFRESH_GRACE_MS ?? 30_000,
  );
  // Rate-limit de login en memoria: frena fuerza bruta por IP+email.
  private readonly loginMaxAttempts = Number(
    process.env.LOGIN_MAX_ATTEMPTS ?? 8,
  );
  private readonly loginWindowMs = Number(
    process.env.LOGIN_WINDOW_MS ?? 15 * 60 * 1000,
  );
  private readonly loginAttempts = new Map<string, AttemptRecord>();

  // Pases tras el alta ya canjeados (jti → cuándo deja de importar). Un pase
  // vive dos minutos; recordar el jti tres cubre cualquier reloj desajustado.
  private readonly usedHandoffs = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly orgs: OrganizationService,
    private readonly jwt: JwtService,
  ) {}

  // ── Registro ───────────────────────────────────────────────
  // El primer usuario del sistema es ADMIN (bootstrap); los siguientes son
  // AGENT (vendedores). Un vendedor recién registrado no ve ninguna
  // conversación hasta que un admin le asigne fuentes.
  async register(input: RegisterInput): Promise<PublicUser> {
    const email = input.email.toLowerCase().trim();
    const orgId = this.tenant.orgId();
    const existing = await runUnscoped("registro: comprobar correo libre", () =>
      this.prisma.user.findUnique({ where: { orgId_email: { orgId, email } } }),
    );
    if (existing) {
      throw new ConflictException("Ese correo ya está registrado");
    }
    const userCount = await this.prisma.user.count();
    const role: Role = (userCount === 0 ? "ADMIN" : "AGENT") as Role;
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        orgId,
        name: input.name.trim(),
        email,
        passwordHash,
        role,
      },
    });
    return this.toPublicUser(user);
  }

  // ── Login ──────────────────────────────────────────────────
  async login(input: LoginInput, meta: DeviceMeta): Promise<AuthTokens> {
    const email = input.email.toLowerCase().trim();
    const throttleKey = `${meta.ipAddress ?? "?"}:${email}`;
    this.assertNotThrottled(throttleKey);

    // De qué empresa es quien intenta entrar.
    //
    // En SaaS sale del subdominio, que el servidor pone a partir del `Host`.
    // Es un dato que el visitante controla, y por eso solo sirve para **elegir
    // a quién buscar**: la contraseña sigue decidiendo si entra, y el `orgId`
    // del token se toma de la fila del usuario, no de aquí. Cambiar el `Host`
    // no te mete en otra empresa; como mucho hace que no te encuentren.
    if (tenancyMode === "multi" && !input.orgSlug) {
      // En SaaS el mismo correo puede existir en dos empresas: sin subdominio
      // la búsqueda sería "a ver a quién encuentro", y eso no es un login.
      throw new BadRequestException(
        "Indica la dirección de tu empresa (subdominio)",
      );
    }

    const orgId = input.orgSlug
      ? (await this.orgs.resolveSlug(input.orgSlug))?.id
      : null;

    if (input.orgSlug && !orgId) {
      this.recordFailedLogin(throttleKey);
      throw new UnauthorizedException("Credenciales inválidas");
    }

    // Agujero 1/4: la búsqueda del usuario no puede filtrarse por la
    // organización del contexto, porque el contexto es justo lo que falta.
    // Cuando llega `orgSlug`, el filtro va explícito en el `where`.
    const user = await runUnscoped("login: buscar usuario por correo", () =>
      orgId
        ? this.prisma.user.findUnique({
            where: { orgId_email: { orgId, email } },
          })
        : this.prisma.user.findFirst({ where: { email } }),
    );
    if (!user || !user.isActive) {
      this.recordFailedLogin(throttleKey);
      throw new UnauthorizedException("Credenciales inválidas");
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      this.recordFailedLogin(throttleKey);
      throw new UnauthorizedException("Credenciales inválidas");
    }
    // Login correcto → se limpia el contador de intentos.
    this.loginAttempts.delete(throttleKey);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        platform: meta.platform,
        deviceName: meta.deviceName ?? null,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: this.refreshExpiry(),
      },
    });

    return this.issueTokens(user, session.id);
  }

  // ── Pase tras el alta ──────────────────────────────────────
  /**
   * Canjea el pase que devolvió el alta de empresa por una sesión de verdad.
   *
   * Existe porque la cookie de sesión pertenece al subdominio de la empresa,
   * y el alta ocurre en el dominio principal: no hay forma de dejar al
   * usuario dentro sin cruzar el dominio con algo firmado. Ese algo es un JWT
   * de dos minutos y **un solo uso**: viaja en la URL, así que acaba en el
   * historial del navegador y quizá en un log, y por eso no puede servir dos
   * veces ni durar más que el tiempo de un redirect.
   */
  async redeemHandoff(rawToken: string, meta: DeviceMeta): Promise<AuthTokens> {
    let claims: { sub?: string; org?: string; purpose?: string; jti?: string };
    try {
      claims = await this.jwt.verifyAsync(rawToken, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException("El pase ha caducado o no es válido");
    }
    if (claims.purpose !== "handoff" || !claims.sub || !claims.jti || !claims.org) {
      throw new UnauthorizedException("El pase no es válido");
    }

    this.pruneHandoffs();
    if (this.usedHandoffs.has(claims.jti)) {
      throw new UnauthorizedException("Este pase ya se usó");
    }
    this.usedHandoffs.set(claims.jti, Date.now() + 3 * 60_000);

    // Sin contexto de organización todavía —es justo lo que este pase
    // establece—, así que la carga del usuario va sin filtrar, y la empresa
    // se comprueba a mano contra la que firmó el alta.
    const user = await runUnscoped("pase tras el alta: cargar usuario", () =>
      this.prisma.user.findUnique({ where: { id: claims.sub } }),
    );
    if (!user || !user.isActive || user.orgId !== claims.org) {
      throw new UnauthorizedException("El pase no es válido");
    }

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        platform: meta.platform,
        deviceName: meta.deviceName ?? null,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: this.refreshExpiry(),
      },
    });
    return this.issueTokens(user, session.id);
  }

  private pruneHandoffs(): void {
    const now = Date.now();
    for (const [jti, hasta] of this.usedHandoffs) {
      if (hasta < now) this.usedHandoffs.delete(jti);
    }
  }

  // ── Refresh con rotación + detección de reuso ──────────────
  async refresh(rawToken: string): Promise<AuthTokens> {
    const tokenHash = this.hash(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: { include: { user: true } } },
    });

    if (!stored) throw new UnauthorizedException("Refresh token inválido");

    const { session } = stored;
    const now = new Date();

    // REUSO DETECTADO: token ya rotado o revocado.
    if (stored.rotatedAt || stored.revokedAt || session.revokedAt) {
      // Carrera benigna: el token se rotó hace segundos, no fue revocado y la
      // sesión sigue viva. Es el caso típico de varias pestañas (o requests en
      // paralelo) refrescando a la vez al expirar el access token. Antes esto
      // revocaba TODA la sesión → "logout fantasma". Ahora emitimos tokens
      // nuevos sobre la misma sesión en vez de revocar.
      const benignRace =
        stored.rotatedAt &&
        !stored.revokedAt &&
        !session.revokedAt &&
        now.getTime() - stored.rotatedAt.getTime() < this.refreshGraceMs;

      if (
        benignRace &&
        session.expiresAt > now &&
        session.user.isActive
      ) {
        const next = await this.createRefreshToken(session.id);
        await this.prisma.session.update({
          where: { id: session.id },
          data: { lastUsedAt: now },
        });
        return this.issueTokens(session.user, session.id, next.raw);
      }

      // Reuso real (token viejo fuera de la ventana, o ya revocado) → robo
      // probable: se revoca toda la familia (la sesión completa).
      await this.revokeSession(session.id);
      throw new ForbiddenException(
        "Refresh token reutilizado. Sesión revocada por seguridad.",
      );
    }

    if (stored.expiresAt < now || session.expiresAt < now) {
      throw new UnauthorizedException("Sesión expirada");
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException("Usuario inactivo");
    }

    // Empresa suspendida desde la consola de plataforma: las sesiones que
    // quedaban abiertas se cortan en el siguiente refresco.
    const empresa = await this.prisma.organization.findUnique({
      where: { id: session.user.orgId },
      select: { isActive: true },
    });
    if (empresa && !empresa.isActive) {
      throw new UnauthorizedException("Empresa suspendida");
    }

    // Rotación: emitir un nuevo refresh y marcar el viejo como rotado.
    const next = await this.createRefreshToken(session.id);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { rotatedAt: new Date(), replacedById: next.id },
    });
    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    return this.issueTokens(session.user, session.id, next.raw);
  }

  // ── Logout (revoca la sesión asociada al refresh) ──────────
  async logout(rawToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });
    if (stored) await this.revokeSession(stored.sessionId);
  }

  /** Lo que la web guarda en sesión. `platformAdmin` solo tiene sentido en SaaS. */
  private toPublicUser(
    user: { id: string; email: string; name: string | null; role: string; permissions?: unknown },
    orgSlug?: string,
  ): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      orgSlug,
      permissions: effectivePermissions(user.role, user.permissions ?? null),
      // Los usuarios de empresa nunca son operadores: la cuenta maestra es
      // aparte (admin.<dominio>, PLATFORM_ADMIN_EMAIL).
      platformAdmin: false,
    };
  }

  // ── Cuenta / perfil ────────────────────────────────────────
  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("Usuario no encontrado");
    return this.toPublicUser(user);
  }

  async updateProfile(userId: string, name: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: name.trim() },
    });
    return this.toPublicUser(user);
  }

  // Cambia la contraseña verificando la actual. Por seguridad, revoca todas
  // las demás sesiones (deja viva solo la actual): si alguien tenía la cuenta
  // abierta con la contraseña vieja, queda fuera.
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("Usuario no encontrado");

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException("La contraseña actual no es correcta");

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.revokeOtherSessions(userId, keepSessionId);
  }

  // Revoca todas las sesiones del usuario salvo la indicada (la actual).
  async revokeOtherSessions(
    userId: string,
    keepSessionId?: string,
  ): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
      },
      select: { id: true },
    });
    await Promise.all(sessions.map((s) => this.revokeSession(s.id)));
  }

  // ── Listar sesiones activas del usuario ────────────────────
  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
    });
    return sessions.map((s) => ({
      id: s.id,
      platform: s.platform as Platform,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  // Token corto (2 min) solo para el handshake del WebSocket. Evita exponer
  // el access token de 15 min al JS del navegador.
  async issueRealtimeToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(
      { sub: claims.sub, sid: claims.sid, role: claims.role, org: claims.org },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "2m" },
    );
  }

  // Revoca una sesión concreta del usuario (cerrar un dispositivo remoto).
  async revokeUserSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new UnauthorizedException("Sesión no encontrada");
    await this.revokeSession(sessionId);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Helpers ────────────────────────────────────────────────
  private async issueTokens(
    user: {
      id: string;
      orgId: string;
      email: string;
      name: string | null;
      role: string;
    },
    sessionId: string,
    existingRefresh?: string,
  ): Promise<AuthTokens> {
    const refresh = existingRefresh
      ? { raw: existingRefresh }
      : await this.createRefreshToken(sessionId);

    const claims: AccessTokenClaims = {
      sub: user.id,
      sid: sessionId,
      role: user.role as Role,
      org: user.orgId,
    };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: this.accessTtl,
    });

    // `Organization` no lleva orgId, así que esta consulta no pasa por el
    // filtro de empresa y no necesita contexto.
    const org = await this.prisma.organization.findUnique({
      where: { id: user.orgId },
      select: { slug: true },
    });

    const publicUser = this.toPublicUser(user, org?.slug);

    return {
      accessToken,
      refreshToken: refresh.raw,
      expiresIn: this.ttlSeconds(this.accessTtl),
      user: publicUser,
    };
  }

  private async createRefreshToken(sessionId: string) {
    const raw = randomBytes(32).toString("hex");
    const created = await this.prisma.refreshToken.create({
      data: {
        sessionId,
        tokenHash: this.hash(raw),
        expiresAt: this.refreshExpiry(),
      },
    });
    return { id: created.id, raw };
  }

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  // ── Rate-limit de login (anti fuerza bruta) ────────────────
  private assertNotThrottled(key: string): void {
    const rec = this.loginAttempts.get(key);
    if (!rec) return;
    // Ventana expirada → se reinicia el contador.
    if (Date.now() - rec.firstAt > this.loginWindowMs) {
      this.loginAttempts.delete(key);
      return;
    }
    if (rec.count >= this.loginMaxAttempts) {
      throw new HttpException(
        "Demasiados intentos de inicio de sesión. Espera unos minutos.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordFailedLogin(key: string): void {
    const now = Date.now();
    const rec = this.loginAttempts.get(key);
    if (!rec || now - rec.firstAt > this.loginWindowMs) {
      this.loginAttempts.set(key, { count: 1, firstAt: now });
    } else {
      rec.count += 1;
    }
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }

  private ttlSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2];
    const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
    return value * mult;
  }
}
