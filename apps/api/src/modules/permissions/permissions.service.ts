import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  ACTION_LABELS,
  SECTION_LABELS,
  effectivePermissions,
  type PermissionAction,
  type PermissionSection,
  type UserPermissions,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

export interface ResolvedPermissions {
  role: string;
  perms: UserPermissions;
  /** Fuentes asignadas (solo importan con scope = "sources"). */
  sourceIds: string[];
}

/** Lo que ha resuelto una vez vale unos segundos: evita una consulta por petición. */
const TTL_MS = 15_000;

/**
 * Qué puede ver y hacer cada usuario de la empresa.
 *
 * Es el único sitio que traduce los permisos guardados a condiciones de
 * consulta (qué conversaciones, qué contactos) y a comprobaciones (puede
 * reasignar, puede abrir el panel). Un administrador siempre pasa.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, { at: number; value: ResolvedPermissions }>();

  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<ResolvedPermissions> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, permissions: true, sources: { select: { sourceId: true } } },
    });
    if (!user) throw new ForbiddenException("Usuario no encontrado");
    const value: ResolvedPermissions = {
      role: user.role,
      perms: effectivePermissions(user.role, user.permissions),
      sourceIds: user.sources.map((s) => s.sourceId),
    };
    this.cache.set(userId, { at: Date.now(), value });
    return value;
  }

  /** Tras cambiar permisos o fuentes de alguien, para que aplique al momento. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** Condición sobre conversaciones según el alcance; null = sin restricción. */
  async conversationWhere(userId: string): Promise<Prisma.ConversationWhereInput | null> {
    const { perms, sourceIds } = await this.forUser(userId);
    if (perms.scope === "sources") return { contact: { sourceId: { in: sourceIds } } };
    if (perms.scope === "assigned") return { assignedAgentId: userId };
    return null;
  }

  /** Condición sobre contactos según el alcance; null = sin restricción. */
  async contactWhere(userId: string): Promise<Prisma.ContactWhereInput | null> {
    const { perms, sourceIds } = await this.forUser(userId);
    if (perms.scope === "sources") return { sourceId: { in: sourceIds } };
    if (perms.scope === "assigned") return { conversations: { some: { assignedAgentId: userId } } };
    return null;
  }

  async canSeePhone(userId: string): Promise<boolean> {
    return (await this.forUser(userId)).perms.actions.seePhone;
  }

  async assertAction(userId: string, action: PermissionAction): Promise<void> {
    const { perms } = await this.forUser(userId);
    if (perms.actions[action]) return;
    throw new ForbiddenException(`No tienes permiso para esto: ${ACTION_LABELS[action].toLowerCase()}. Pídeselo a un administrador.`);
  }

  async assertSection(userId: string, section: PermissionSection): Promise<void> {
    const { perms } = await this.forUser(userId);
    if (perms.sections[section]) return;
    throw new ForbiddenException(`No tienes acceso a ${SECTION_LABELS[section].toLowerCase()}. Pídeselo a un administrador.`);
  }

  /** La conversación existe y entra en el alcance del usuario; si no, 403 (no 404: existe, pero no es suya). */
  async assertConversation(userId: string, conversationId: string): Promise<void> {
    const scope = await this.conversationWhere(userId);
    if (!scope) return;
    const found = await this.prisma.conversation.findFirst({ where: { id: conversationId, ...scope }, select: { id: true } });
    if (!found) {
      const exists = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
      if (!exists) throw new NotFoundException("Conversación no encontrada");
      throw new ForbiddenException("Esta conversación no está en tu alcance");
    }
  }

  async assertMessageConversation(userId: string, messageId: string): Promise<void> {
    const scope = await this.conversationWhere(userId);
    if (!scope) return;
    const m = await this.prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true } });
    if (!m) throw new NotFoundException("Mensaje no encontrado");
    await this.assertConversation(userId, m.conversationId);
  }
}
