import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PromptAssistantReply, PromptAssistantRequest } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { AgentActionsService } from "./agent-actions.service";
import { LLM_PROVIDER, type LLMProvider } from "./llm.provider";
import { availableTools } from "./tools.registry";
import {
  buildSystem,
  buildUserTurn,
  fallbackTemplate,
  parseReply,
  type PromptContext,
} from "./prompt-assistant.prompt";

/**
 * Asistente de redacción: ayuda a escribir las instrucciones de un agente
 * (o cualquier otro texto del CRM) con el modelo de la propia empresa y con
 * su contexto real: catálogo, conocimiento, embudo y herramientas.
 *
 * Solo propone; nada se guarda hasta que el usuario aplica el texto al campo.
 */
@Injectable()
export class PromptAssistantService {
  private readonly logger = new Logger("PromptAssistant");

  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: AgentActionsService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  async run(input: PromptAssistantRequest): Promise<PromptAssistantReply> {
    const ctx = await this.loadContext(input.enabledTools);
    const system = buildSystem(ctx, input.target);

    const messages = [
      ...input.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: buildUserTurn(input) },
    ];
    while (messages.length && messages[0]!.role === "assistant") messages.shift();

    let raw = "";
    let model = "—";
    try {
      const res = await this.llm.generate({
        feature: "prompt_assistant",
        system,
        messages,
        effort: "high",
        maxTokens: 4000,
      });
      model = res.model;
      raw = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim();
    } catch (e) {
      this.logger.error(`Fallo del asistente: ${(e as Error).message}`);
      return {
        message: `No pude redactar el texto: ${(e as Error).message}`,
        proposal: null,
        model,
        provider: this.llm.name,
      };
    }

    // Sin API key el proveedor simulado responde como si fuera un cliente:
    // mejor una plantilla honesta que un texto que no tiene sentido.
    if (this.llm.name === "fake") {
      const fb = fallbackTemplate(input.target, ctx, input);
      return { ...fb, model, provider: this.llm.name };
    }

    const parsed = parseReply(raw);
    return { ...parsed, model, provider: this.llm.name };
  }

  // ── Contexto real del workspace ─────────────────────────────
  private async loadContext(enabledTools: string[]): Promise<PromptContext> {
    const orgId = currentOrgId();
    const [
      org,
      productsTotal,
      products,
      [productFields, baseCurrencies, extraCurrencies, withImage],
      knowledgeTotal,
      knowledge,
      pipeline,
      tags,
      sellers,
      toolCtx,
    ] = await Promise.all([
      orgId
        ? this.prisma.organization
            .findUnique({ where: { id: orgId }, select: { name: true } })
            .catch(() => null)
        : Promise.resolve(null),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.product.findMany({
        where: { isActive: true },
        select: { name: true, price: true, currency: true },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
      // Qué datos trae cada producto, para que las instrucciones pidan consultarlos.
      Promise.all([
        this.prisma.productField.findMany({ orderBy: { order: "asc" }, select: { label: true, unit: true, aiVisible: true } }),
        this.prisma.product.groupBy({ by: ["currency"], where: { isActive: true } }),
        this.prisma.productPrice.groupBy({ by: ["currency"], where: { product: { isActive: true } } }),
        this.prisma.product.count({ where: { isActive: true, imageUrl: { not: null } } }),
      ]),
      this.prisma.knowledgeDoc.count({ where: { isActive: true } }),
      this.prisma.knowledgeDoc.findMany({
        where: { isActive: true },
        select: { title: true },
        orderBy: { updatedAt: "desc" },
        take: 15,
      }),
      this.prisma.pipeline.findFirst({
        where: { isDefault: true },
        select: { stages: { select: { name: true }, orderBy: { order: "asc" } } },
      }),
      this.prisma.tag.findMany({ select: { name: true }, orderBy: { name: "asc" }, take: 30 }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.actions.loadContext(),
    ]);

    const enabled = new Set(enabledTools);
    return {
      orgName: org?.name ?? null,
      products: {
        total: productsTotal,
        sample: products.map((p) => ({
          name: p.name,
          price: `${p.currency} ${Number(p.price).toLocaleString("es")}`,
        })),
        fields: productFields.filter((f) => f.aiVisible).map((f) => (f.unit ? `${f.label} (${f.unit})` : f.label)),
        hiddenFields: productFields.filter((f) => !f.aiVisible).map((f) => f.label),
        currencies: [...new Set([...baseCurrencies, ...extraCurrencies].map((c) => c.currency))],
        withImage,
      },
      knowledge: { total: knowledgeTotal, titles: knowledge.map((k) => k.title) },
      stages: pipeline?.stages.map((s) => s.name) ?? [],
      tags: tags.map((t) => t.name),
      sellers,
      tools: availableTools(toolCtx).map((t) => ({
        name: t.name,
        description: t.description,
        enabled: enabled.has(t.name),
        unavailable: t.unavailableReason,
      })),
    };
  }
}
