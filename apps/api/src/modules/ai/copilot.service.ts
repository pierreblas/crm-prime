import { MediaUnderstandingService } from "./media-understanding.service";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import {
  countryFromPhone,
  type AiStatus,
  type ContactMemory,
  type CopilotAskInput,
  type CopilotAskResult,
  type CopilotRewriteInput,
  type CopilotRewriteResult,
  type CopilotSummary,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, tenancyMode } from "../../infra/tenant/tenant.context";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AiSettingsService } from "./ai-settings.service";
import { estimateCostUsd, memoryText } from "./agent.service";
import { LLM_PROVIDER, type LLMProvider } from "./llm.provider";
import type { LlmMessage } from "./llm.types";
import {
  MEMORY_SYSTEM,
  SUMMARY_SYSTEM,
  askSystem,
  cleanRewrite,
  parseMemory,
  parseSummary,
  rewriteSystem,
  toContactMemory,
} from "./copilot.prompts";

/**
 * El copiloto: la IA que ayuda al equipo humano dentro de la conversación.
 *
 * Todo va con la clave de IA de la empresa. Si no hay ninguna configurada,
 * se responde con un error claro (AI_NOT_CONFIGURED) en vez de devolver texto
 * simulado: en SaaS un resultado inventado confundiría al cliente, y Driony
 * no presta créditos propios.
 *
 * Cada llamada queda como un AiRun de la conversación, así el gasto aparece
 * junto al del agente automático.
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger("Copilot");

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly knowledge: KnowledgeService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  status(): Promise<AiStatus> {
    return this.settings.status();
  }

  /**
   * Sin clave no hay copiloto; con la IA de Driony y los tokens del mes
   * gastados, tampoco (el margen de gracia es para que el agente termine lo
   * empezado, no para el copiloto). En desarrollo local se deja pasar al simulado.
   */
  private async assertReady(): Promise<void> {
    const s = await this.settings.status();
    if (s.ready && s.source === "included" && s.included && (s.included.full || s.included.exhausted)) {
      throw new BadRequestException({
        statusCode: 400,
        code: "AI_NOT_CONFIGURED",
        message: "Se gastaron los tokens de IA de Driony de este mes. Suma tokens extra en Ajustes › Plan, conecta tu clave en Ajustes › Inteligencia Artificial o espera al día 1.",
      });
    }
    if (s.ready) return;
    const devSimulado = tenancyMode !== "multi" && process.env.NODE_ENV !== "production";
    if (devSimulado) return;
    throw new BadRequestException({
      statusCode: 400,
      code: "AI_NOT_CONFIGURED",
      message:
        "Configura tu clave de OpenAI o Anthropic en Ajustes › Inteligencia Artificial. Driony no cobra por la IA: usas tu propia clave.",
    });
  }

  // ── Reescribir el borrador ──────────────────────────────────
  async rewrite(conversationId: string, input: CopilotRewriteInput): Promise<CopilotRewriteResult> {
    await this.assertReady();
    let sample = "";
    if (input.mode === "translate" && (!input.language || input.language === "customer")) {
      const last = await this.prisma.message.findMany({
        where: { conversationId, direction: "INBOUND", content: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { content: true },
      });
      sample = last.map((m) => m.content).reverse().join("\n");
    }
    const res = await this.call(conversationId, {
      system: rewriteSystem(input.mode, input.language ?? null, sample),
      messages: [{ role: "user", content: input.text }],
      maxTokens: 900,
      effort: "low",
    });
    const text = cleanRewrite(res);
    if (!text) throw new BadRequestException("La IA no devolvió texto. Inténtalo de nuevo.");
    return { text };
  }

  // ── Resumen ─────────────────────────────────────────────────
  async summary(conversationId: string): Promise<CopilotSummary> {
    await this.assertReady();
    const transcript = await this.transcript(conversationId, 120);
    if (!transcript) {
      return { summary: "Todavía no hay mensajes en esta conversación.", points: [], nextStep: null, mood: null };
    }
    const raw = await this.call(conversationId, {
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: transcript }],
      maxTokens: 700,
      effort: "low",
    });
    return parseSummary(raw);
  }

  // ── Preguntar sobre el cliente ──────────────────────────────
  async ask(conversationId: string, input: CopilotAskInput): Promise<CopilotAskResult> {
    await this.assertReady();
    const context = await this.askContext(conversationId, input.question);
    const messages: LlmMessage[] = [
      ...input.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: input.question },
    ];
    while (messages.length && messages[0]!.role === "assistant") messages.shift();
    const answer = await this.call(conversationId, {
      system: askSystem(context),
      messages,
      maxTokens: 700,
      effort: "medium",
    });
    return { answer: answer.trim() };
  }

  // ── Memoria del cliente ─────────────────────────────────────
  async memoryFor(conversationId: string): Promise<ContactMemory> {
    const c = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contact: { select: { aiMemory: true, aiMemoryAt: true } } },
    });
    if (!c) throw new NotFoundException("Conversación no encontrada");
    return toContactMemory(c.contact.aiMemory, c.contact.aiMemoryAt);
  }

  async refreshMemory(conversationId: string): Promise<ContactMemory> {
    await this.assertReady();
    const c = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    if (!c) throw new NotFoundException("Conversación no encontrada");
    return this.updateMemory(c.contactId, conversationId);
  }

  /**
   * Al cerrar una conversación se actualiza la memoria del cliente, en
   * segundo plano. Sin clave de IA, o si falla, no pasa nada: la memoria es
   * una ayuda, nunca un paso que bloquee el cierre.
   */
  @OnEvent("conversation.closed", { async: true })
  async onClosed(payload: { conversationId: string; orgId: string }): Promise<void> {
    await runInOrg(payload.orgId, async () => {
      try {
        const s = await this.settings.status();
        if (!s.ready) return;
        const c = await this.prisma.conversation.findUnique({
          where: { id: payload.conversationId },
          select: { contactId: true, _count: { select: { messages: true } } },
        });
        if (!c || c._count.messages < 2) return;
        await this.updateMemory(c.contactId, payload.conversationId);
      } catch (e) {
        this.logger.warn(`No se pudo actualizar la memoria: ${(e as Error).message}`);
      }
    });
  }

  private async updateMemory(contactId: string, conversationId: string): Promise<ContactMemory> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { name: true, aiMemory: true },
    });
    if (!contact) throw new NotFoundException("Contacto no encontrado");

    // Las conversaciones más recientes del cliente, de la más vieja a la nueva.
    const convs = await this.prisma.conversation.findMany({
      where: { contactId },
      orderBy: { lastMessageAt: "desc" },
      take: 3,
      select: { id: true },
    });
    const parts: string[] = [];
    for (const conv of convs.reverse()) {
      const t = await this.transcript(conv.id, 60);
      if (t) parts.push(t);
    }
    const previous = memoryText(contact.aiMemory) || "(vacía)";
    const raw = await this.call(conversationId, {
      system: MEMORY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Cliente: ${contact.name ?? "sin nombre"}\n\nMemoria anterior:\n${previous}\n\nConversaciones recientes:\n${parts.join("\n\n---\n\n") || "(sin mensajes)"}`,
        },
      ],
      maxTokens: 600,
      effort: "low",
    });
    const memory = parseMemory(raw);
    const at = new Date();
    await this.prisma.contact.update({
      where: { id: contactId },
      data: { aiMemory: memory as unknown as Prisma.InputJsonValue, aiMemoryAt: at },
    });
    return toContactMemory(memory, at);
  }

  // ── Internos ────────────────────────────────────────────────

  /** Llama al modelo y deja constancia del gasto en la conversación. */
  private async call(
    conversationId: string,
    req: { system: string; messages: LlmMessage[]; maxTokens: number; effort: string },
  ): Promise<string> {
    const started = Date.now();
    const res = await this.llm.generate({ ...req, feature: "copilot", conversationId });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    void this.prisma.aiRun
      .create({
        data: {
          conversationId,
          status: "COMPLETED",
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costUsd: estimateCostUsd(res.model, res.usage.inputTokens, res.usage.outputTokens),
          latencyMs: Date.now() - started,
        },
      })
      .catch(() => undefined);
    return text;
  }

  /** La conversación como texto: "Cliente:" / "Equipo:" / "IA:". */
  private async transcript(conversationId: string, take: number): Promise<string> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take,
      select: { direction: true, author: true, content: true, note: true, type: true, createdAt: true },
    });
    return rows
      .reverse()
      .map((m) => {
        const who = m.direction === "INBOUND" ? "Cliente" : m.author === "AI" ? "IA" : "Equipo";
        const body = MediaUnderstandingService.historyTextOf(m);
        return `${who}: ${body}`;
      })
      .join("\n");
  }

  /** Todo lo que el copiloto puede usar para responder sobre el cliente. */
  private async askContext(conversationId: string, question: string): Promise<string> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: {
          include: {
            tags: { include: { tag: true } },
            source: true,
            deals: { include: { stage: true }, orderBy: { createdAt: "desc" }, take: 5 },
          },
        },
        notes: { orderBy: { createdAt: "desc" }, take: 10, include: { author: true } },
      },
    });
    if (!conv) throw new NotFoundException("Conversación no encontrada");
    const ct = conv.contact;
    const country = countryFromPhone(ct.phone);
    const fields =
      ct.metadata && typeof ct.metadata === "object"
        ? Object.entries(ct.metadata as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" && v)
            .map(([k, v]) => `${k}: ${v}`)
        : [];

    const blocks: string[] = [
      `Cliente: ${ct.name ?? "sin nombre"} · ${ct.phone}${country ? ` · ${country.name}` : ""}`,
      ct.source ? `Fuente: ${ct.source.name}` : "",
      ct.tags.length ? `Etiquetas: ${ct.tags.map((t) => t.tag.name).join(", ")}` : "",
      fields.length ? `Campos: ${fields.join(" · ")}` : "",
      ct.deals.length
        ? `Oportunidades:\n${ct.deals
            .map((d) => `- ${d.title} · ${d.stage.name}${d.value !== null ? ` · ${Number(d.value)} ${d.currency}` : ""}${d.discardedAt ? " · descartada" : ""}`)
            .join("\n")}`
        : "",
      memoryText(ct.aiMemory) ? `Memoria del cliente:\n${memoryText(ct.aiMemory)}` : "",
      conv.notes.length
        ? `Notas internas del equipo:\n${conv.notes.map((n) => `- ${n.author.name ?? "Equipo"}: ${n.body}`).join("\n")}`
        : "",
    ];

    const others = await this.prisma.conversation.findMany({
      where: { contactId: ct.id, id: { not: conversationId } },
      orderBy: { lastMessageAt: "desc" },
      take: 2,
      select: { id: true, lastMessageAt: true },
    });
    for (const o of others) {
      const t = await this.transcript(o.id, 20);
      if (t) blocks.push(`Conversación anterior (${o.lastMessageAt?.toISOString().slice(0, 10) ?? "?"}):\n${t}`);
    }
    blocks.push(`Conversación actual:\n${(await this.transcript(conversationId, 60)) || "(sin mensajes)"}`);

    try {
      const hits = await this.knowledge.search(question, 3);
      const useful = hits.filter((h) => h.score > 0.15);
      if (useful.length) {
        blocks.push(`Base de conocimiento:\n${useful.map((h) => `[${h.docTitle}] ${h.content}`).join("\n\n")}`);
      }
    } catch {
      // Sin conocimiento no pasa nada: se responde con lo demás.
    }
    return blocks.filter(Boolean).join("\n\n");
  }
}
