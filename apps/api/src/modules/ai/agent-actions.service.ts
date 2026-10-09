import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma } from "@prisma/client";
import {
  contactCurrency,
  MessageAuthor,
  MessageType,
  type ResolveActionsResult,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { MessagingService } from "../messaging/messaging.service";
import { isActionTool, type ToolContext } from "./tools.registry";

// Lo que se guarda en AiToolCall.input para poder re-ejecutar tras aprobar.
type ActionInput = Record<string, unknown>;

/**
 * Ejecuta las acciones que la IA pide sobre el CRM (etiquetar, mover de
 * etapa, actualizar la ficha, asignar vendedor) y gestiona su aprobación.
 *
 * Reglas:
 *  - En AUTOPILOT se aplican al momento (AiToolCall queda en EXECUTED).
 *  - En COPILOT quedan en PENDING_APPROVAL y solo se aplican cuando el
 *    agente humano envía la respuesta; si la descarta, pasan a REJECTED.
 *  - En el playground no se toca la BD: solo se describe lo que haría.
 */
const LEAD_LABEL: Record<string, string> = { potential: "potencial", purchase: "compra", lost: "perdido" };

@Injectable()
export class AgentActionsService {
  private readonly logger = new Logger("AgentActions");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly messaging: MessagingService,
    private readonly events: EventEmitter2,
  ) {}

  // Valores reales del workspace para construir los esquemas de las tools.
  async loadContext(): Promise<ToolContext> {
    const [tags, stages, sellers, customFields, products, leadStages] = await Promise.all([
      this.prisma.tag.findMany({
        select: { name: true },
        orderBy: { name: "asc" },
      }),
      // El agente trabaja sobre el embudo predeterminado.
      this.prisma.pipelineStage.findMany({
        where: { pipeline: { isDefault: true } },
        select: { name: true },
        orderBy: { order: "asc" },
      }),
      this.prisma.user.findMany({
        where: { isActive: true },
        select: { name: true, email: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.customField.findMany({
        select: { key: true, label: true, options: true },
        orderBy: { order: "asc" },
      }),
      // Solo los que tienen foto: son los únicos que se pueden enviar.
      this.prisma.product.findMany({
        where: { isActive: true, imageUrl: { not: null } },
        select: { name: true },
        orderBy: { name: "asc" },
        take: 100,
      }),
      // Etapas con rol (potencial / ganada / perdida): habilitan mark_lead.
      this.prisma.pipelineStage.findMany({
        where: { OR: [{ isQualified: true }, { isWon: true }, { isLost: true }] },
        select: { isQualified: true, isWon: true, isLost: true },
      }),
    ]);
    const leadStatuses = [
      ...(leadStages.some((s) => s.isQualified) ? ["potential"] : []),
      ...(leadStages.some((s) => s.isWon) ? ["purchase"] : []),
      ...(leadStages.some((s) => s.isLost) ? ["lost"] : []),
    ];

    return {
      tags: tags.map((t) => t.name),
      stages: stages.map((s) => s.name),
      sellers: sellers.map((u) => u.name ?? u.email),
      customFields,
      productsWithImage: products.map((p) => p.name),
      leadStatuses,
    };
  }

  // Texto corto para la UI y para devolverle al modelo como tool_result.
  summarize(tool: string, input: ActionInput): string {
    switch (tool) {
      case "add_tag":
        return `Poner la etiqueta «${String(input.tag)}»`;
      case "remove_tag":
        return `Quitar la etiqueta «${String(input.tag)}»`;
      case "move_deal_stage":
        return `Mover el pipeline a «${String(input.stage)}»${
          input.reason ? ` (${String(input.reason)})` : ""
        }`;
      case "assign_to_seller":
        return `Asignar a «${String(input.seller)}»`;
      case "mark_lead":
        return `Marcar como ${LEAD_LABEL[String(input.status)] ?? String(input.status)}${
          input.reason ? ` (${String(input.reason)})` : ""
        }`;
      case "send_product_image":
        return `Enviar la foto de «${String(input.product)}»`;
      case "update_contact": {
        const fields = Object.entries(input)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${k}=${String(v)}`);
        return fields.length
          ? `Actualizar la ficha: ${fields.join(", ")}`
          : "Actualizar la ficha del contacto";
      }
      default:
        return tool;
    }
  }

  // ── Ejecución real ──────────────────────────────────────────
  // Devuelve un texto de resultado; lanza si la acción no se puede aplicar.
  async execute(
    tool: string,
    input: ActionInput,
    contactId: string,
    // Solo lo necesitan las acciones que mandan mensajes al cliente.
    conversationId: string | null = null,
  ): Promise<string> {
    switch (tool) {
      case "add_tag":
        return this.addTag(contactId, String(input.tag ?? ""));
      case "remove_tag":
        return this.removeTag(contactId, String(input.tag ?? ""));
      case "move_deal_stage":
        return this.moveDeal(contactId, String(input.stage ?? ""));
      case "assign_to_seller":
        return this.assignSeller(contactId, String(input.seller ?? ""));
      case "mark_lead":
        return this.markLead(contactId, String(input.status ?? ""), String(input.reason ?? ""));
      case "update_contact":
        return this.updateContact(contactId, input);
      case "send_product_image":
        return this.sendProductImage(conversationId, input);
      default:
        throw new Error(`Acción desconocida: ${tool}`);
    }
  }

  private async addTag(contactId: string, tagName: string): Promise<string> {
    const tag = await this.prisma.tag.findFirst({ where: { name: tagName } });
    if (!tag) throw new Error(`La etiqueta "${tagName}" no existe`);
    // Idempotente: si ya la tiene, no es un error.
    await this.prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId: tag.id } },
      create: { contactId, tagId: tag.id },
      update: {},
    });
    this.events.emit("contact.tagged", { orgId: this.tenant.orgId(), contactId, tag: tag.name });
    return `Etiqueta "${tagName}" añadida al contacto.`;
  }

  private async removeTag(contactId: string, tagName: string): Promise<string> {
    const tag = await this.prisma.tag.findFirst({ where: { name: tagName } });
    if (!tag) throw new Error(`La etiqueta "${tagName}" no existe`);
    await this.prisma.contactTag.deleteMany({
      where: { contactId, tagId: tag.id },
    });
    return `Etiqueta "${tagName}" quitada del contacto.`;
  }

  /**
   * Potencial / compra / perdido: la etapa que la empresa reservó para cada
   * caso en el embudo de su oportunidad (o en el predeterminado si no tiene).
   */
  private async markLead(contactId: string, status: string, reason: string): Promise<string> {
    const label = LEAD_LABEL[status];
    if (!label) throw new Error(`Clasificación desconocida: ${status}`);
    const deal = await this.prisma.deal.findFirst({
      where: { contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { stage: { select: { pipelineId: true } } },
    });
    const pipelineId =
      deal?.stage.pipelineId ??
      (await this.prisma.pipeline.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ??
      (await this.prisma.pipeline.findFirst({ orderBy: { order: "asc" }, select: { id: true } }))?.id;
    if (!pipelineId) throw new Error("No hay ningún embudo configurado");
    const flag = status === "potential" ? { isQualified: true } : status === "purchase" ? { isWon: true } : { isLost: true };
    const stage = await this.prisma.pipelineStage.findFirst({ where: { pipelineId, ...flag }, orderBy: { order: "asc" } });
    if (!stage) throw new Error(`El embudo no tiene una etapa marcada como «${label}» (Ajustes › Embudos)`);
    const why = reason ? ` (${reason})` : "";
    const orgId = this.tenant.orgId();
    if (deal) {
      if (deal.stageId === stage.id) return `Ya estaba marcado como ${label} («${stage.name}»).`;
      await this.prisma.deal.update({ where: { id: deal.id }, data: { stageId: stage.id } });
      this.events.emit("deal.stage_changed", { orgId, dealId: deal.id, contactId, stageId: stage.id });
      this.events.emit("pipeline.changed", { orgId, dealId: deal.id });
      return `Marcado como ${label}: oportunidad movida a «${stage.name}»${why}.`;
    }
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { orgId: true, name: true, phone: true, currency: true },
    });
    if (!contact) throw new Error("El contacto ya no existe");
    const created = await this.prisma.deal.create({
      data: {
        orgId: contact.orgId,
        contactId,
        stageId: stage.id,
        title: contact.name ?? contact.phone,
        currency: contactCurrency(contact) ?? "USD",
      },
    });
    this.events.emit("deal.stage_changed", { orgId, dealId: created.id, contactId, stageId: stage.id });
    this.events.emit("pipeline.changed", { orgId, dealId: created.id });
    return `Marcado como ${label}: oportunidad creada en «${stage.name}»${why}.`;
  }

  private async moveDeal(contactId: string, stageName: string): Promise<string> {
    // Con varios embudos el nombre puede repetirse: gana el predeterminado.
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { name: stageName },
      orderBy: { pipeline: { isDefault: "desc" } },
    });
    if (!stage) throw new Error(`La etapa "${stageName}" no existe`);

    const deal = await this.prisma.deal.findFirst({
      where: { contactId, discardedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (deal) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { stageId: stage.id },
      });
      this.events.emit("deal.stage_changed", {
        orgId: this.tenant.orgId(),
        dealId: deal.id,
        contactId,
        stageId: stage.id,
      });
      return `Oportunidad movida a "${stageName}".`;
    }

    // Sin oportunidad previa: se crea en la etapa pedida. La organización
    // sale del contacto, que es de donde cuelga la oportunidad.
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { orgId: true, name: true, phone: true, currency: true },
    });
    if (!contact) throw new Error("El contacto ya no existe");
    await this.prisma.deal.create({
      data: {
        orgId: contact.orgId,
        contactId,
        stageId: stage.id,
        title: contact.name ?? contact.phone,
        currency: contactCurrency(contact) ?? "USD",
      },
    });
    return `Oportunidad creada en "${stageName}".`;
  }

  private async assignSeller(
    contactId: string,
    sellerName: string,
  ): Promise<string> {
    const seller = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [{ name: sellerName }, { email: sellerName }],
      },
      select: { id: true },
    });
    if (!seller) throw new Error(`El vendedor "${sellerName}" no existe`);

    const deal = await this.prisma.deal.findFirst({
      where: { contactId, discardedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!deal) {
      throw new Error(
        "El contacto no tiene ninguna oportunidad a la que asignar un vendedor",
      );
    }
    await this.prisma.deal.update({
      where: { id: deal.id },
      data: { ownerId: seller.id },
    });
    return `Oportunidad asignada a "${sellerName}".`;
  }

  // El nombre va a su columna; el resto de claves, a metadata (campos
  // personalizados), respetando las que ya tuviera el contacto.
  private async updateContact(
    contactId: string,
    input: ActionInput,
  ): Promise<string> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { metadata: true },
    });
    if (!contact) throw new Error("El contacto no existe");

    const known = await this.prisma.customField.findMany({
      select: { key: true },
    });
    const allowed = new Set(known.map((f) => f.key));

    const metadata: Record<string, unknown> = {
      ...((contact.metadata as Record<string, unknown> | null) ?? {}),
    };
    const changed: string[] = [];
    let name: string | undefined;

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null || value === "") continue;
      if (key === "name") {
        name = String(value);
        changed.push("nombre");
        continue;
      }
      // Se ignoran claves que no correspondan a un campo personalizado real.
      if (!allowed.has(key)) continue;
      metadata[key] = value;
      changed.push(key);
    }

    if (!changed.length) return "No había nada que actualizar.";

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(name !== undefined ? { name } : {}),
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
    return `Ficha actualizada: ${changed.join(", ")}.`;
  }

  /**
   * Manda la foto de un producto por WhatsApp. La URL es la que el negocio
   * cargó en la ficha del producto, así que se envía como `link` y es Meta
   * quien la descarga: por eso tiene que ser pública.
   */
  private async sendProductImage(
    conversationId: string | null,
    input: ActionInput,
  ): Promise<string> {
    if (!conversationId) {
      throw new Error("No hay conversación a la que enviar la imagen");
    }
    const name = String(input.product ?? "");
    const product = await this.prisma.product.findFirst({
      where: { name, isActive: true },
      select: { name: true, imageUrl: true },
    });
    if (!product) throw new Error(`El producto "${name}" no existe`);
    if (!product.imageUrl) {
      throw new Error(`"${name}" no tiene imagen cargada`);
    }

    await this.messaging.queueOutbound(
      {
        conversationId,
        type: MessageType.IMAGE,
        mediaUrl: product.imageUrl,
        caption: String(input.caption ?? "").trim() || undefined,
      },
      MessageAuthor.AI,
    );
    return `Foto de "${product.name}" enviada.`;
  }

  // ── Registro y aprobación ───────────────────────────────────
  async record(
    aiRunId: string,
    tool: string,
    input: ActionInput,
    status: "PENDING_APPROVAL" | "EXECUTED" | "ERROR",
    output: string,
  ): Promise<string> {
    const row = await this.prisma.aiToolCall.create({
      data: {
        aiRunId,
        toolName: tool,
        input: input as Prisma.InputJsonObject,
        output: { result: output },
        status,
        resolvedAt: status === "PENDING_APPROVAL" ? null : new Date(),
      },
    });
    return row.id;
  }

  async pendingFor(
    aiRunId: string,
  ): Promise<{ id: string; tool: string; summary: string }[]> {
    const rows = await this.prisma.aiToolCall.findMany({
      where: { aiRunId, status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      tool: r.toolName,
      summary: this.summarize(r.toolName, (r.input ?? {}) as ActionInput),
    }));
  }

  /**
   * Resuelve las acciones pendientes de un run: las ejecuta (el humano envió
   * la respuesta) o las descarta (la desechó). Una acción que falle no
   * bloquea a las demás: se marca ERROR y se informa.
   */
  async resolve(
    aiRunId: string,
    approve: boolean,
    userId: string,
  ): Promise<ResolveActionsResult> {
    const run = await this.prisma.aiRun.findUnique({
      where: { id: aiRunId },
      select: { id: true, conversationId: true },
    });
    if (!run) throw new NotFoundException("Run de IA no encontrado");

    const pending = await this.prisma.aiToolCall.findMany({
      where: { aiRunId, status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
    });
    if (!pending.length) return { executed: [], rejected: 0, errors: [] };

    if (!approve) {
      await this.prisma.aiToolCall.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: {
          status: "REJECTED",
          approvedById: userId,
          resolvedAt: new Date(),
        },
      });
      return { executed: [], rejected: pending.length, errors: [] };
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: run.conversationId },
      select: { contactId: true },
    });
    if (!conversation) throw new NotFoundException("Conversación no encontrada");

    const executed: string[] = [];
    const errors: string[] = [];

    for (const call of pending) {
      const input = (call.input ?? {}) as ActionInput;
      try {
        if (!isActionTool(call.toolName)) {
          throw new Error(`No es una acción: ${call.toolName}`);
        }
        const result = await this.execute(
          call.toolName,
          input,
          conversation.contactId,
          run.conversationId,
        );
        await this.prisma.aiToolCall.update({
          where: { id: call.id },
          data: {
            status: "EXECUTED",
            approvedById: userId,
            output: { result },
            resolvedAt: new Date(),
          },
        });
        executed.push(result);
      } catch (e) {
        const message = (e as Error).message;
        this.logger.warn(`Acción ${call.toolName} falló: ${message}`);
        await this.prisma.aiToolCall.update({
          where: { id: call.id },
          data: {
            status: "ERROR",
            approvedById: userId,
            errorReason: message.slice(0, 300),
            resolvedAt: new Date(),
          },
        });
        errors.push(`${this.summarize(call.toolName, input)}: ${message}`);
      }
    }

    return { executed, rejected: 0, errors };
  }
}
