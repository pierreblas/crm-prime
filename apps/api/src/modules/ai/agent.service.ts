import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { contactCurrency, countryFromPhone, estimateAiCost, formatFieldValue, priceFor } from "@crm/shared";
import type {
  AiSuggestion,
  Classification,
  EscalationRules,
  PlaygroundReply,
  PlaygroundRequest,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { MediaUnderstandingService } from "./media-understanding.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AgentActionsService } from "./agent-actions.service";
import { BotService } from "./bot.service";
import { LLM_PROVIDER, type LLMProvider } from "./llm.provider";
import type {
  LlmMessage,
  LlmToolResultBlock,
  LlmToolUseBlock,
} from "./llm.types";
import { isActionTool, resolveTools } from "./tools.registry";


/** Coste estimado en USD de una llamada. 0 si el modelo no tiene precio conocido. */
export function estimateCostUsd(model: string, input: number, output: number): number {
  return estimateAiCost(model, input, output) ?? 0;
}

// Conversaciones anteriores del contacto que entran como contexto.
const HISTORY_DAYS = 30;

@Injectable()
export class AgentService {
  private readonly logger = new Logger("Agent");

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly bots: BotService,
    private readonly actions: AgentActionsService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  async suggest(conversationId: string): Promise<AiSuggestion> {
    const started = Date.now();
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });
    if (!conversation) throw new NotFoundException("Conversación no encontrada");

    const windowOpen =
      !!conversation.windowExpiresAt && conversation.windowExpiresAt > new Date();

    // El agente de su embudo, el del número, o el predeterminado.
    const config = await this.bots.resolveForConversation(conversation);

    const system = this.buildSystem(config?.systemPrompt, conversation.contact);
    const messages = await this.buildHistory(conversationId);
    // Las acciones necesitan los valores reales (etiquetas, etapas, vendedores)
    // para que el modelo elija de una lista cerrada en vez de inventarlos.
    const toolContext = await this.actions.loadContext();
    const tools = resolveTools(config?.enabledTools ?? [], toolContext);
    // En autopilot la IA aplica sus acciones sola; en copilot quedan
    // pendientes hasta que el humano envía la respuesta.
    const autoApply = conversation.aiMode === "AUTOPILOT";
    const maxIterations = config?.maxIterations ?? 6;
    const effort = config?.effort ?? "medium";

    // Clasificación previa del último mensaje del contacto.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText =
      typeof lastUser?.content === "string" ? lastUser.content : "";
    const classification = await this.classifySafe(lastUserText);

    // RAG: si la tool search_knowledge está habilitada, recuperar fragmentos
    // relevantes de la base de conocimiento y fundamentar la respuesta.
    const ragEnabled = (config?.enabledTools ?? []).includes("search_knowledge");
    const knowledge =
      ragEnabled && lastUserText ? await this.retrieveSafe(lastUserText) : [];

    // Presupuesto mensual: si ya se agotó, ni se llama al modelo. Antes este
    // campo se guardaba y no cortaba nada, así que no era un límite real.
    const budget = await this.checkBudget(config);
    if (budget.exceeded) {
      this.logger.warn(
        `Presupuesto agotado para "${config?.name}": ${budget.spent} de ${budget.limit} tokens`,
      );
      return {
        runId: "",
        suggestion: null,
        classification: null,
        escalate: true,
        escalationReason: `Presupuesto mensual de tokens agotado (${budget.spent} de ${budget.limit}).`,
        windowOpen,
        model: config?.model ?? "—",
        provider: this.llm.name,
        toolsUsed: [],
        pendingActions: [],
      };
    }

    const run = await this.prisma.aiRun.create({
      data: {
        conversationId,
        agentConfigId: config?.id ?? null,
        status: "RUNNING",
        model: config?.model ?? "claude-opus-4-8",
      },
    });

    let suggestion: string | null = null;
    let escalate = false;
    let escalationReason: string | null = null;
    let status = "COMPLETED";
    let inputTokens = 0;
    let outputTokens = 0;
    let model = config?.model ?? "claude-opus-4-8";
    const toolsUsed: string[] = [];

    // Llamadas ya hechas (herramienta + argumentos). Sin esto, un modelo que
    // no encuentra lo que busca repite la misma consulta hasta agotar las
    // iteraciones: visto en producción, 12.500 tokens para responder "gracias".
    const seenCalls = new Set<string>();

    try {
      for (let i = 0; i < maxIterations; i++) {
        const res = await this.llm.generate({
          system,
          messages,
          tools: tools.length ? tools : undefined,
          knowledge: knowledge.length ? knowledge : undefined,
          effort,
          maxTokens: 1024,
          model: config?.model,
          feature: "agent",
          conversationId,
        });
        inputTokens += res.usage.inputTokens;
        outputTokens += res.usage.outputTokens;
        model = res.model;

        if (res.stopReason === "refusal") {
          escalate = true;
          escalationReason = "El modelo rechazó la solicitud (safety).";
          status = "REFUSED";
          break;
        }

        const toolUses = res.content.filter(
          (b): b is LlmToolUseBlock => b.type === "tool_use",
        );

        if (toolUses.length === 0) {
          suggestion = res.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("")
            .trim();
          status = "COMPLETED";
          break;
        }

        // Añadir el turno del asistente con sus bloques (text + tool_use).
        messages.push({ role: "assistant", content: res.content });

        // ¿Está repitiendo consultas que ya hizo? Entonces no va a avanzar:
        // se le devuelve el aviso y se le pide que responda con lo que tiene.
        const repeated = toolUses.filter((tu) =>
          seenCalls.has(this.callKey(tu)),
        );
        if (repeated.length === toolUses.length) {
          messages.push({ role: "assistant", content: res.content });
          messages.push({
            role: "user",
            content: toolUses.map((tu) => ({
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content:
                "Ya consultaste esto y el resultado no ha cambiado. Responde al cliente con la información que ya tienes, o usa handoff_to_human si no puedes resolverlo.",
            })),
          });
          for (const tu of toolUses) seenCalls.add(this.callKey(tu));
          continue;
        }

        const results: LlmToolResultBlock[] = [];
        for (const tu of toolUses) {
          seenCalls.add(this.callKey(tu));
          toolsUsed.push(tu.name);
          const { output, escalated, reason } = await this.runTool(
            run.id,
            conversation.contact,
            tu,
            autoApply,
            conversationId,
          );
          if (escalated) {
            escalate = true;
            escalationReason = reason ?? "Escalado por la IA.";
          }
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: output,
          });
        }
        messages.push({ role: "user", content: results });

        if (i === maxIterations - 1 && !suggestion) {
          status = "ESCALATED";
          escalate = true;
          escalationReason =
            escalationReason ?? "Se alcanzó el máximo de iteraciones.";
        }
      }
    } catch (e) {
      this.logger.error(`Fallo del agente: ${(e as Error).message}`);
      status = "ERROR";
      escalate = true;
      escalationReason = "Error al generar la respuesta.";
    }

    // Guardrail: la clasificación puede forzar el escalado a humano.
    if (classification?.requiresHuman && !escalate) {
      escalate = true;
      escalationReason =
        escalationReason ?? "La conversación requiere atención humana.";
      if (status === "COMPLETED") status = "ESCALATED";
    }

    // Reglas de escalado configuradas en el bot.
    if (!escalate) {
      const rule = this.checkEscalationRules(
        (config?.escalationRules as EscalationRules | null) ?? null,
        classification,
        lastUserText,
      );
      if (rule) {
        escalate = true;
        escalationReason = rule;
        if (status === "COMPLETED") status = "ESCALATED";
      }
    }

    const costUsd = this.cost(model, inputTokens, outputTokens);
    await this.prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: status as
          | "COMPLETED"
          | "ESCALATED"
          | "REFUSED"
          | "ERROR"
          | "RUNNING",
        model,
        inputTokens,
        outputTokens,
        costUsd,
        classification: classification
          ? (classification as unknown as Prisma.InputJsonObject)
          : undefined,
        confidence: classification ? this.confidence(classification) : null,
        escalationReason,
        latencyMs: Date.now() - started,
      },
    });

    // Lo que quedó pendiente de aprobación (vacío en autopilot: ya se aplicó).
    const pendingActions = (await this.actions.pendingFor(run.id)).map((p) => ({
      ...p,
      applied: false,
    }));

    return {
      runId: run.id,
      suggestion,
      classification: classification ?? null,
      escalate,
      escalationReason,
      windowOpen,
      model,
      provider: this.llm.name,
      toolsUsed: [
        ...new Set([
          ...toolsUsed,
          ...(knowledge.length ? ["search_knowledge"] : []),
        ]),
      ],
      pendingActions,
    };
  }

  // ── Playground: probar el agente con texto libre, sin persistir ─
  // No crea conversación, ni AiRun, ni envía nada. Reutiliza la config del bot
  // (prompt, herramientas, modelo) para que el resultado sea fiel al real.
  async playground(input: PlaygroundRequest): Promise<PlaygroundReply> {
    const config = input.botId
      ? await this.prisma.agentConfig.findUnique({ where: { id: input.botId } })
      : await this.bots.resolveForChannel(null);

    const contact = { name: "Cliente de prueba", phone: "+000000000" };
    const system = this.buildSystem(config?.systemPrompt, contact);
    const toolContext = await this.actions.loadContext();
    const tools = resolveTools(config?.enabledTools ?? [], toolContext);
    // En el playground las acciones no se aplican: solo se listan.
    const simulatedActions: string[] = [];
    const maxIterations = config?.maxIterations ?? 6;
    const effort = config?.effort ?? "medium";

    const messages: LlmMessage[] = [
      ...input.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: input.message },
    ];
    // La API exige que el primer mensaje sea del usuario.
    while (messages.length && messages[0]!.role === "assistant") messages.shift();

    const ragEnabled = (config?.enabledTools ?? []).includes("search_knowledge");
    const knowledge = ragEnabled ? await this.retrieveSafe(input.message) : [];

    let reply: string | null = null;
    let escalate = false;
    let escalationReason: string | null = null;
    let model = config?.model ?? "claude-opus-4-8";
    let inputTokens = 0;
    let outputTokens = 0;
    const toolsUsed: string[] = [];

    try {
      for (let i = 0; i < maxIterations; i++) {
        const res = await this.llm.generate({
          feature: "playground",
          system,
          messages,
          tools: tools.length ? tools : undefined,
          knowledge: knowledge.length ? knowledge : undefined,
          effort,
          maxTokens: 1024,
          model: config?.model,
        });
        inputTokens += res.usage.inputTokens;
        outputTokens += res.usage.outputTokens;
        model = res.model;

        if (res.stopReason === "refusal") {
          escalate = true;
          escalationReason = "El modelo rechazó la solicitud (safety).";
          break;
        }

        const toolUses = res.content.filter(
          (b): b is LlmToolUseBlock => b.type === "tool_use",
        );

        if (toolUses.length === 0) {
          reply = res.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("")
            .trim();
          break;
        }

        messages.push({ role: "assistant", content: res.content });
        const results: LlmToolResultBlock[] = [];
        for (const tu of toolUses) {
          toolsUsed.push(tu.name);
          const { output, escalated, reason } = await this.runTool(
            null,
            { ...contact, id: "playground", optIn: true, lastMessageAt: null },
            tu,
            false,
            null,
          );
          if (isActionTool(tu.name)) simulatedActions.push(output);
          if (escalated) {
            escalate = true;
            escalationReason = reason ?? "Escalado por la IA.";
          }
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: output,
          });
        }
        messages.push({ role: "user", content: results });
      }
    } catch (e) {
      this.logger.error(`Fallo del playground: ${(e as Error).message}`);
      escalate = true;
      escalationReason = "Error al generar la respuesta.";
    }

    return {
      reply,
      simulatedActions,
      escalate,
      escalationReason,
      model,
      provider: this.llm.name,
      toolsUsed: [
        ...new Set([
          ...toolsUsed,
          ...(knowledge.length ? ["search_knowledge"] : []),
        ]),
      ],
      inputTokens,
      outputTokens,
      costUsd: this.cost(model, inputTokens, outputTokens),
    };
  }

  private async retrieveSafe(query: string): Promise<string[]> {
    try {
      return await this.knowledge.retrieve(query, 3);
    } catch (e) {
      this.logger.warn(`Recuperación RAG falló: ${(e as Error).message}`);
      return [];
    }
  }

  private async classifySafe(text: string): Promise<Classification | null> {
    if (!text.trim()) return null;
    try {
      return await this.llm.classify(text);
    } catch (e) {
      this.logger.warn(`Clasificación falló: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Aplica las reglas de escalado del bot. Devuelve el motivo si alguna se
   * cumple, o null si el agente puede seguir solo.
   *
   * Estas reglas se guardaban en `AgentConfig.escalationRules` y no las leía
   * nadie: el panel prometía un control que no existía.
   */
  private checkEscalationRules(
    rules: EscalationRules | null,
    classification: Classification | null,
    lastUserText: string,
  ): string | null {
    if (!rules) return null;

    // Palabras que piden humano explícitamente ("quiero hablar con un agente").
    const keywords = (rules.keywords ?? [])
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (keywords.length && lastUserText) {
      const text = lastUserText.toLowerCase();
      const hit = keywords.find((k) => text.includes(k));
      if (hit) return `El cliente mencionó "${hit}".`;
    }

    if (!classification) return null;

    if (rules.escalateOnNegativeSentiment && classification.sentiment === "negative") {
      return "El cliente está molesto (sentimiento negativo).";
    }

    if (rules.minConfidence !== undefined) {
      const score = this.confidence(classification);
      if (score < rules.minConfidence) {
        return `Confianza baja (${score} por debajo del umbral ${rules.minConfidence}).`;
      }
    }

    return null;
  }

  /**
   * Tokens gastados este mes por el bot frente a su presupuesto.
   * `monthlyTokenBudget = 0` significa sin límite.
   */
  private async checkBudget(config: { id: string; monthlyTokenBudget: number } | null): Promise<{
    exceeded: boolean;
    spent: number;
    limit: number;
  }> {
    const limit = config?.monthlyTokenBudget ?? 0;
    if (!config || limit <= 0) return { exceeded: false, spent: 0, limit: 0 };

    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const agg = await this.prisma.aiRun.aggregate({
      where: { agentConfigId: config.id, createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const spent =
      (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
    return { exceeded: spent >= limit, spent, limit };
  }

  // Identidad de una llamada a herramienta: mismo nombre y mismos argumentos.
  private callKey(tu: LlmToolUseBlock): string {
    return `${tu.name}:${JSON.stringify(tu.input ?? {})}`;
  }

  private confidence(c: Classification): number {
    // Heurística simple: menor confianza si requiere humano o es negativo.
    let v = 0.85;
    if (c.requiresHuman) v -= 0.3;
    if (c.sentiment === "negative") v -= 0.15;
    if (c.urgency === "high") v -= 0.1;
    return Math.max(0.1, Number(v.toFixed(2)));
  }

  // ── Herramientas ───────────────────────────────────────────────
  private async runTool(
    aiRunId: string | null,
    contact: {
      id: string;
      name: string | null;
      phone: string;
      currency?: string | null;
      optIn: boolean;
      lastMessageAt: Date | null;
    },
    tu: LlmToolUseBlock,
    autoApply: boolean,
    conversationId: string | null,
  ): Promise<{ output: string; escalated: boolean; reason?: string }> {
    let output = "";
    let escalated = false;
    let reason: string | undefined;

    // ── Acciones que escriben en el CRM ──────────────────────────
    if (isActionTool(tu.name)) {
      return this.runAction(aiRunId, contact.id, conversationId, tu, autoApply);
    }

    if (tu.name === "search_contact") {
      const country = countryFromPhone(contact.phone);
      output = JSON.stringify({
        name: contact.name,
        phone: contact.phone,
        country: country?.name ?? null,
        currency: contactCurrency(contact),
        optIn: contact.optIn,
        lastMessageAt: contact.lastMessageAt?.toISOString() ?? null,
      });
    } else if (tu.name === "search_knowledge") {
      const hits = await this.knowledge.search(String(tu.input.query ?? ""), 4);
      output = JSON.stringify(
        hits.map((h) => ({ doc: h.docTitle, content: h.content })),
      );
    } else if (tu.name === "search_products") {
      // Etapa 1: el agente lee el catálogo. Si hay término, filtra; si no
      // encuentra nada (o no hay término), devuelve el catálogo completo para
      // que el agente tenga la información y no responda "no hay" por error.
      const q = String(tu.input.query ?? "").trim();
      const MAX = 50;
      const select = {
        id: true,
        name: true,
        price: true,
        currency: true,
        sku: true,
        description: true,
        imageUrl: true,
        attributes: true,
        prices: { select: { currency: true, amount: true } },
      } as const;
      const baseWhere = { isActive: true } as const;
      // Campos personalizados (talla, color…): nombre legible para el agente.
      // Solo los que el negocio deja ver a la IA.
      const fieldDefs = await this.prisma.productField.findMany({
        where: { aiVisible: true },
        orderBy: { order: "asc" },
        select: { key: true, label: true, type: true, unit: true },
      });
      const fieldDef = new Map(fieldDefs.map((f) => [f.key, f]));

      let rows = q
        ? await this.prisma.product.findMany({
            where: {
              ...baseWhere,
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
              ],
            },
            orderBy: { name: "asc" },
            take: MAX,
            select,
          })
        : [];

      // También por el valor de un campo personalizado ("talla M", "rojo").
      // Solo en los campos visibles para la IA: los ocultos no se pueden sondear.
      if (q && rows.length < MAX && fieldDefs.length) {
        const orgId = currentOrgId();
        const keys = fieldDefs.map((f) => f.key);
        const byAttr = orgId
          ? await this.prisma.$queryRaw<{ id: string }[]>`
              SELECT id FROM products p
              WHERE p."orgId" = ${orgId} AND p."isActive" AND EXISTS (
                SELECT 1 FROM jsonb_each_text(COALESCE(p.attributes, '{}'::jsonb)) a
                WHERE a.key = ANY(${keys}) AND a.value ILIKE ${"%" + q + "%"}
              )
              LIMIT ${MAX}`
          : [];
        const have = new Set(rows.map((r) => r.id));
        const extra = byAttr.map((r) => r.id).filter((id) => !have.has(id));
        if (extra.length) {
          rows = [
            ...rows,
            ...(await this.prisma.product.findMany({ where: { id: { in: extra } }, select, take: MAX - rows.length })),
          ];
        }
      }

      // Sin término o sin coincidencias → catálogo completo (hasta MAX).
      let listedAll = false;
      if (rows.length === 0) {
        rows = await this.prisma.product.findMany({
          where: baseWhere,
          orderBy: { name: "asc" },
          take: MAX,
          select,
        });
        listedAll = true;
      }

      const total = await this.prisma.product.count({ where: baseWhere });
      // Precio en la moneda del cliente si el producto la tiene; si no, el
      // precio base, marcado para que el agente no lo "convierta" por su cuenta.
      const clientCurrency = contactCurrency(contact);
      const items = rows.map((p) => {
        const hit = priceFor(
          {
            price: Number(p.price),
            currency: p.currency,
            prices: p.prices.map((x) => ({ currency: x.currency, amount: Number(x.amount) })),
          },
          clientCurrency,
        );
        return {
        name: p.name,
        price: hit.amount,
        currency: hit.currency,
        ...(clientCurrency ? { priceInClientCurrency: !hit.fallback } : {}),
        sku: p.sku,
        description: p.description,
        ...(() => {
          const attrs = (p.attributes as Record<string, string> | null) ?? {};
          const details = Object.fromEntries(
            Object.entries(attrs)
              .filter(([k, v]) => fieldDef.has(k) && typeof v === "string" && v)
              .map(([k, v]) => [fieldDef.get(k)!.label, formatFieldValue(fieldDef.get(k)!, v)]),
          );
          return Object.keys(details).length ? { details } : {};
        })(),
        // Se expone solo si TIENE foto, no la URL: así el modelo sabe que
        // puede mandarla (con send_product_image) pero no puede inventarse
        // ni filtrar un enlace.
        hasImage: !!p.imageUrl,
        };
      });
      output = JSON.stringify({
        clientCurrency,
        // Nota para el agente: si filtró y no hubo match, le devolvemos todo.
        note:
          total === 0
            ? "El catálogo está vacío."
            : q && listedAll
              ? `Sin coincidencias exactas para "${q}"; se lista el catálogo completo.`
              : listedAll
                ? "Catálogo completo."
                : `Resultados para "${q}".`,
        total,
        truncated: total > MAX,
        products: items,
      });
    } else if (tu.name === "handoff_to_human") {
      reason = String(tu.input.reason ?? "Escalado solicitado por la IA.");
      escalated = true;
      output = "Se registró el escalado a un agente humano.";
    } else {
      output = `Herramienta desconocida: ${tu.name}`;
    }

    // En el playground (aiRunId null) no se persiste la llamada a la tool.
    if (aiRunId) {
      await this.prisma.aiToolCall.create({
        data: {
          aiRunId,
          toolName: tu.name,
          input: tu.input as Prisma.InputJsonObject,
          output: { result: output },
          status: "EXECUTED",
          resolvedAt: new Date(),
        },
      });
    }

    return { output, escalated, reason };
  }

  /**
   * Ejecuta (o aparca) una acción sobre el CRM y le devuelve al modelo un
   * tool_result honesto: si queda pendiente de aprobación, se lo decimos,
   * para que no le prometa al cliente algo que aún no ha pasado.
   */
  private async runAction(
    aiRunId: string | null,
    contactId: string,
    conversationId: string | null,
    tu: LlmToolUseBlock,
    autoApply: boolean,
  ): Promise<{ output: string; escalated: boolean; reason?: string }> {
    const summary = this.actions.summarize(tu.name, tu.input);

    // Playground: nada toca la BD, solo se describe lo que haría.
    if (!aiRunId) {
      return {
        output: `(simulado, no se aplicó) ${summary}`,
        escalated: false,
      };
    }

    if (!autoApply) {
      await this.actions.record(
        aiRunId,
        tu.name,
        tu.input,
        "PENDING_APPROVAL",
        summary,
      );
      return {
        output: `Acción registrada: ${summary}. Queda PENDIENTE hasta que el agente humano apruebe la respuesta; todavía no se ha aplicado.`,
        escalated: false,
      };
    }

    try {
      const result = await this.actions.execute(
        tu.name,
        tu.input,
        contactId,
        conversationId,
      );
      await this.actions.record(aiRunId, tu.name, tu.input, "EXECUTED", result);
      return { output: result, escalated: false };
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`Acción ${tu.name} falló: ${message}`);
      await this.actions.record(aiRunId, tu.name, tu.input, "ERROR", message);
      return { output: `No se pudo aplicar: ${message}`, escalated: false };
    }
  }

  // ── Construcción del contexto ──────────────────────────────────
  private buildSystem(
    base: string | undefined,
    contact: { name: string | null; phone: string; currency?: string | null; aiMemory?: unknown },
  ): string {
    const country = countryFromPhone(contact.phone);
    const memory = memoryText(contact.aiMemory);
    const currency = contactCurrency(contact);
    const where = [
      country ? ` País: ${country.name}.` : "",
      currency ? ` Cotiza en ${currency}.` : "",
    ].join("");
    const fallback =
      "Eres un asistente de atención al cliente por WhatsApp. Responde en español, breve y cordial. Redacta una posible respuesta para que un agente humano la revise antes de enviarla. Si no estás seguro o el caso lo amerita, usa la herramienta handoff_to_human.";
    return [
      base ?? fallback,
      `\n\nContacto actual: ${contact.name ?? "(sin nombre)"} (${contact.phone}).${where}`,
      memory ? `\n\nLo que sabemos de este cliente (de conversaciones anteriores):\n${memory}` : "",
      "Devuelve únicamente el texto de la respuesta sugerida, sin prefijos como 'Respuesta:'.",
    ].join("");
  }

  /**
   * Los últimos mensajes del contacto, también de sus conversaciones
   * anteriores (cerradas hace poco): al «cerrar y siguiente» el cliente suele
   * seguir el mismo hilo, y sin ese contexto la IA no sabe de qué habla.
   */
  private async buildHistory(conversationId: string): Promise<LlmMessage[]> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
    const recent = await this.prisma.message.findMany({
      where: convo
        ? { OR: [{ conversationId }, { conversation: { contactId: convo.contactId }, createdAt: { gte: since } }] }
        : { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 40,
    });
    const rows = recent.reverse();
    // Un audio o una imagen entran con lo que la IA entendió de ellos
    // (transcripción o descripción), no como un «[audio]» mudo.
    const msgs: LlmMessage[] = rows.map((m) => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: MediaUnderstandingService.textOf(m) || `[${m.type.toLowerCase()}]`,
    }));
    // La API exige que el primer mensaje sea del usuario.
    while (msgs.length && msgs[0]!.role === "assistant") msgs.shift();
    if (msgs.length === 0) {
      msgs.push({ role: "user", content: "(el contacto inició la conversación)" });
    }
    return msgs;
  }

  private cost(model: string, input: number, output: number): number {
    return estimateCostUsd(model, input, output);
  }
}

/** La memoria del cliente como texto para el prompt, o "" si no hay. */
export function memoryText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const m = raw as { summary?: unknown; facts?: unknown };
  const lines: string[] = [];
  if (typeof m.summary === "string" && m.summary.trim()) lines.push(m.summary.trim());
  if (Array.isArray(m.facts)) {
    for (const f of m.facts) if (typeof f === "string" && f.trim()) lines.push(`- ${f.trim()}`);
  }
  return lines.join("\n");
}
