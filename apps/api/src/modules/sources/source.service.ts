import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type {
  CreateSourceInput,
  CreateUserInput,
  SellerDto,
  SourceDto,
  SourceKind,
  UpdateSourceInput,
  UpdateUserInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { PlansService } from "../plans/plans.service";
import { PermissionsService } from "../permissions/permissions.service";
import { Prisma } from "@prisma/client";
import { effectivePermissions } from "@crm/shared";

@Injectable()
export class SourceService {
  constructor(
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly perms: PermissionsService,
  ) {}

  // ── Fuentes ──────────────────────────────────────────────────
  /**
   * Las fuentes con cuántos contactos tienen y qué canales las alimentan hoy:
   * cada número de WhatsApp, página (formularios, Messenger, Instagram) y los
   * anuncios click-to-WhatsApp van a la fuente que la empresa eligió para ese
   * canal o, si no eligió, a la automática de su vía.
   */
  async list(): Promise<SourceDto[]> {
    const [rows, numbers, pages, tiktoks] = await Promise.all([
      this.prisma.source.findMany({
        orderBy: [{ kind: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        include: { _count: { select: { contacts: true } } },
      }),
      this.prisma.whatsappConnection.findMany({
        where: { isActive: true },
        select: { label: true, displayPhoneNumber: true, phoneNumberId: true, sourceId: true },
      }),
      this.prisma.metaPage.findMany({
        where: { isActive: true },
        select: {
          name: true,
          instagramUsername: true,
          sourceId: true,
          messengerEnabled: true,
          messengerSourceId: true,
          instagramEnabled: true,
          instagramSourceId: true,
        },
      }),
      this.prisma.tikTokAccount.findMany({
        where: { isActive: true },
        select: { username: true, displayName: true, sourceId: true },
      }),
    ]);
    const autoId = (kind: SourceKind) => rows.find((r) => r.kind === kind)?.id ?? null;
    const feeds = new Map<string, { kind: SourceKind; label: string }[]>();
    const feed = (sourceId: string | null, kind: SourceKind, label: string) => {
      const id = sourceId ?? autoId(kind);
      if (!id) return;
      feeds.set(id, [...(feeds.get(id) ?? []), { kind, label }]);
    };
    for (const n of numbers) {
      const label = n.label || n.displayPhoneNumber || n.phoneNumberId;
      feed(n.sourceId, "whatsapp", label);
      // Los anuncios click-to-WhatsApp entran por cada número, a la fuente de anuncios.
      feed(null, "ad", label);
    }
    for (const p of pages) {
      feed(p.sourceId, "form", p.name);
      if (p.messengerEnabled) feed(p.messengerSourceId, "messenger", p.name);
      if (p.instagramEnabled) feed(p.instagramSourceId, "instagram", p.instagramUsername ? `@${p.instagramUsername}` : p.name);
    }
    for (const a of tiktoks) feed(a.sourceId, "tiktok", a.username ? `@${a.username}` : (a.displayName ?? "TikTok"));
    return rows.map((s) => this.toDto(s, feeds.get(s.id) ?? []));
  }

  async create(input: CreateSourceInput): Promise<SourceDto> {
    const s = await this.prisma.source.create({
      data: { orgId: this.tenant.orgId(), name: input.name, color: input.color },
      include: { _count: { select: { contacts: true } } },
    });
    return this.toDto(s);
  }

  async update(id: string, input: UpdateSourceInput): Promise<SourceDto> {
    const existing = await this.prisma.source.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Fuente no encontrada");
    const s = await this.prisma.source.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      include: { _count: { select: { contacts: true } } },
    });
    return this.toDto(s);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const s = await this.prisma.source.findUnique({ where: { id } });
    if (!s) throw new NotFoundException("Fuente no encontrada");
    if (s.kind) {
      throw new BadRequestException(
        "Esta fuente la crean tus canales y recibe a quien escribe por ellos. Puedes renombrarla; para que un canal use otra fuente, elígela en Ajustes › Canales.",
      );
    }
    await this.prisma.source.delete({ where: { id } });
    return { ok: true };
  }

  // ── Vendedores / equipo ──────────────────────────────────────
  // Incluye inactivos: el admin necesita verlos para reactivarlos.
  async listSellers(): Promise<{ sellers: SellerDto[]; sources: SourceDto[] }> {
    const [users, sources] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          permissions: true,
          sources: { select: { sourceId: true } },
        },
      }),
      this.list(),
    ]);
    const stats = await this.statsFor(users.map((u) => u.id));
    return {
      sellers: users.map((u) => this.toSeller(u, u.sources.map((s) => s.sourceId), stats.get(u.id))),
      sources,
    };
  }

  /** Chats abiertos, chats con movimiento en 7 días y último acceso, por persona. */
  private async statsFor(userIds: string[]): Promise<Map<string, SellerDto["stats"]>> {
    const out = new Map<string, SellerDto["stats"]>();
    if (userIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; open_assigned: bigint; active7: bigint; last_seen: Date | null }>>`
      SELECT u.id,
        (SELECT count(*) FROM conversations c WHERE c."assignedAgentId" = u.id AND c.status = 'OPEN') AS open_assigned,
        (SELECT count(*) FROM conversations c WHERE c."assignedAgentId" = u.id AND c."lastMessageAt" >= now() - interval '7 days') AS active7,
        (SELECT max(s."lastUsedAt") FROM sessions s WHERE s."userId" = u.id AND s."revokedAt" IS NULL) AS last_seen
      FROM users u WHERE u.id IN (${Prisma.join(userIds)})
    `;
    for (const r of rows) {
      out.set(r.id, { openAssigned: Number(r.open_assigned), active7d: Number(r.active7), lastSeenAt: r.last_seen?.toISOString() ?? null });
    }
    return out;
  }

  private toSeller(
    u: { id: string; name: string | null; email: string; role: string; isActive: boolean; permissions: unknown },
    sourceIds: string[],
    stats?: SellerDto["stats"],
  ): SellerDto {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      sourceIds,
      permissions: effectivePermissions(u.role, u.permissions),
      stats: stats ?? { openAssigned: 0, active7d: 0, lastSeenAt: null },
    };
  }

  // Crea un usuario del equipo (solo admin).
  async createUser(input: CreateUserInput): Promise<SellerDto> {
    const email = input.email.toLowerCase().trim();
    // findFirst y no findUnique: el correo ya solo es único dentro de la
    // empresa, y la extensión acota la consulta a la organización en curso.
    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) throw new ConflictException("Ese correo ya está registrado");
    await this.plans.assertCanAdd("users");

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        orgId: this.tenant.orgId(),
        name: input.name.trim(),
        email,
        passwordHash,
        role: input.role,
        ...(input.permissions ? { permissions: input.permissions } : {}),
      },
    });
    return this.toSeller(user, []);
  }

  // Edita nombre, rol o estado de un usuario (solo admin). `actingUserId` evita
  // que un admin se desactive o se quite a sí mismo el rol y se quede fuera.
  async updateUser(
    id: string,
    input: UpdateUserInput,
    actingUserId: string,
  ): Promise<SellerDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { sources: { select: { sourceId: true } } },
    });
    if (!user) throw new NotFoundException("Usuario no encontrado");

    if (id === actingUserId) {
      if (input.isActive === false) {
        throw new BadRequestException("No puedes desactivar tu propia cuenta");
      }
      if (input.role && input.role !== "ADMIN") {
        throw new BadRequestException("No puedes quitarte el rol de administrador");
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      },
      include: { sources: { select: { sourceId: true } } },
    });
    this.perms.invalidate(id);

    // Al desactivar, se revocan sus sesiones para echarlo del sistema.
    if (input.isActive === false) {
      await this.prisma.$transaction([
        this.prisma.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.refreshToken.updateMany({
          where: { session: { userId: id }, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    }

    const stats = await this.statsFor([id]);
    return this.toSeller(updated, updated.sources.map((s) => s.sourceId), stats.get(id));
  }

  // Reemplaza las fuentes asignadas a un vendedor.
  async assignSources(userId: string, sourceIds: string[]): Promise<SellerDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Vendedor no encontrado");
    await this.prisma.$transaction([
      this.prisma.userSource.deleteMany({ where: { userId } }),
      this.prisma.userSource.createMany({
        data: sourceIds.map((sourceId) => ({ userId, sourceId })),
        skipDuplicates: true,
      }),
    ]);
    this.perms.invalidate(userId);
    const stats = await this.statsFor([userId]);
    return this.toSeller(user, sourceIds, stats.get(userId));
  }

  // ── Fuente de un contacto ────────────────────────────────────
  async setContactSource(
    contactId: string,
    sourceId: string | null,
  ): Promise<{ ok: true }> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) throw new NotFoundException("Contacto no encontrado");
    await this.prisma.contact.update({
      where: { id: contactId },
      data: { sourceId },
    });
    return { ok: true };
  }

  // Fuentes asignadas a un usuario (para filtrar su bandeja).
  async sourceIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.userSource.findMany({
      where: { userId },
      select: { sourceId: true },
    });
    return rows.map((r) => r.sourceId);
  }

  private toDto(
    s: {
      id: string;
      name: string;
      color: string | null;
      kind?: string | null;
      createdAt: Date;
      _count: { contacts: number };
    },
    channels: SourceDto["channels"] = [],
  ): SourceDto {
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      contactCount: s._count.contacts,
      createdAt: s.createdAt.toISOString(),
      kind: (s.kind as SourceKind | null | undefined) ?? null,
      channels,
    };
  }
}
