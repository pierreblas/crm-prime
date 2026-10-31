import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  contactCurrency,
  countryFromPhone,
  estimateAiCost,
  formatFieldValue,
  HANDOFF_REASON_AI_INCLUDED_FULL,
  HANDOFF_REASON_MEDIA,
  priceFor,
  readAdReferral,
} from "@crm/shared";
import type {
  AiSuggestion,
  Classification,
  EscalationRules,
  PlaygroundReply,
  PlaygroundRequest,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { searchProducts } from "./product-search";
import { MediaUnderstandingService } from "./media-understanding.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AgentActionsService } from "./agent-actions.service";
import { BotService } from "./bot.service";
import { AiSettingsService } from "./ai-settings.service";
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
    private readonly aiSettings: AiSettingsService,
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

    // Lo que el agente puede consultar del catálogo y lo que sabe del contacto
    // (sus campos personalizados), para que no ignore datos que sí existen.
    const [catalogFields, contactFieldDefs] = await Promise.all([
      this.prisma.productField.findMany({ where: { aiVisible: true }, select: { label: true } }),
      this.prisma.customField.findMany({ select: { key: true, label: true } }),
    ]);
    const system = this.buildSystemParts(config?.systemPrompt, conversation.contact, config?.enabledTools ?? [], !!config?.splitReplies, {
      catalogFields: catalogFields.map((f) => f.label),
      contactFields: contactFieldDefs,
      referral: conversation.referral,
    });
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

    // IA incluida con el cupo lleno: el agente termina lo que ya atendía este
    // mes, pero no empieza conversaciones nuevas (pasan al equipo).
    if (!(await this.aiSettings.allowsConversation(conversationId))) {
      this.logger.log(`Cupo de IA incluida lleno: ${conversationId} pasa al equipo`);
      return {
        runId: "",
        suggestion: null,
        classification: null,
        escalate: true,
        escalationReason: HANDOFF_REASON_AI_INCLUDED_FULL,
        windowOpen,
        model: config?.model ?? "—",
        provider: this.llm.name,
        toolsUsed: [],
        pendingActions: [],
      };
    }

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
          system: system.system,
          systemDynamic: system.systemDynamic,
          cacheKey: config?.id ? `agent:${config.id}` : undefined,
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

    // Que el clasificador crea que «requiere una persona» no fuerza nada por
    // sí solo: baja la confianza y es el nivel configurado en «Cuándo te pasa
    // el chat» (checkEscalationRules) el que decide. Con «Nunca por su cuenta»
    // el agente lo intenta todo, como promete la pantalla.

    // Reglas de escalado configuradas en el bot.
    if (!escalate) {
      const lastInboundRow = await this.prisma.message.findFirst({
        where: { conversationId, direction: "INBOUND" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { type: true },
      });
      const rule = this.checkEscalationRules(
        (config?.escalationRules as EscalationRules | null) ?? null,
        classification,
        lastUserText,
        lastInboundRow?.type ?? null,
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
    const system = this.buildSystemParts(config?.systemPrompt, contact);
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
          system: system.system,
          systemDynamic: system.systemDynamic,
          cacheKey: config?.id ? `agent:${config.id}` : undefined,
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
    lastInboundType: string | null = null,
  ): string | null {
    if (!rules) return null;

    // Imagen o documento (comprobantes, recetas, formularios): lo valida una persona.
    if (rules.onMedia && (lastInboundType === "IMAGE" || lastInboundType === "DOCUMENT")) {
      return HANDOFF_REASON_MEDIA;
    }

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

    // Sin nivel guardado (bots antiguos) se aplica el recomendado; 0 = nunca por su cuenta.
    const threshold = rules.minConfidence ?? 0.75;
    if (threshold > 0) {
      const score = this.confidence(classification);
      if (score < threshold) {
        return classification.requiresHuman
          ? `El cliente parece pedir una persona (confianza ${score}, nivel ${threshold}).`
          : `Confianza baja (${score} por debajo del nivel ${threshold}).`;
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
      metadata?: unknown;
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
      const meta = (contact.metadata && typeof contact.metadata === "object" ? contact.metadata : {}) as Record<string, unknown>;
      output = JSON.stringify({
        name: contact.name,
        phone: contact.phone,
        country: country?.name ?? null,
        currency: contactCurrency(contact),
        optIn: contact.optIn,
        lastMessageAt: contact.lastMessageAt?.toISOString() ?? null,
        // Campos personalizados del contacto (sin los utm_* de campaña).
        fields: Object.fromEntries(
          Object.entries(meta).filter(([k, v]) => !k.startsWith("utm_") && v != null && String(v).trim() !== ""),
        ),
      });
    } else if (tu.name === "search_knowledge") {
      const hits = await this.knowledge.search(String(tu.input.query ?? ""), 4);
      output = JSON.stringify(
        hits.map((h) => ({ doc: h.docTitle, content: h.content })),
      );
    } else if (tu.name === "search_products") {
      // El agente lee el catálogo. Con término, busca por palabras (sin
      // tildes, en nombre, descripción, SKU y campos visibles) y ordena por
      // relevancia; sin término o sin coincidencias, lista el catálogo. Lo que
      // no cabe con detalle va al menos por nombre, para que con 200 productos
      // el agente sepa que existen y pueda volver a buscar.
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

      const orgId = currentOrgId() ?? "";
      // Un listado del catálogo (sin término o sin coincidencias) va compacto:
      // 20 con detalle y el resto por nombre. Una búsqueda que acierta, hasta 50.
      const found = await searchProducts(this.prisma, orgId, q, { max: MAX, listMax: 20, attrKeys: fieldDefs.map((f) => f.key) });
      const byId = new Map(
        (await this.prisma.product.findMany({ where: { ...baseWhere, id: { in: found.ids } }, select })).map((p) => [p.id, p]),
      );
      const rows = found.ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
      const { total, listedAll, otherNames } = found;
      // Con pocos resultados la descripción va entera (es cuando importa); en
      // listados largos, recortada: el agente puede volver a buscar el producto.
      const brief = rows.length > 5;
      const trim = (d: string | null) => (d && brief && d.length > 160 ? `${d.slice(0, 157).trimEnd()}…` : d);
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
        description: trim(p.description),
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
        truncated: total > rows.length,
        products: items,
        // Nombres del resto del catálogo: si lo que busca el cliente está aquí, vuelve a buscar con ese nombre.
        ...(otherNames.length ? { otherNames } : {}),
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
  /**
   * El prompt en dos partes. `system`: instrucciones y reglas, iguales en cada
   * llamada del mismo agente, para que el proveedor las cachee. `systemDynamic`:
   * lo de este contacto (nombre, país, campos, memoria), que cambia cada vez
   * y va al final para no romper la caché.
   */
  private buildSystemParts(
    base: string | undefined,
    contact: { name: string | null; phone: string; currency?: string | null; aiMemory?: unknown; metadata?: unknown },
    enabledTools: string[] = [],
    splitReplies = false,
    extra: { catalogFields?: string[]; contactFields?: { key: string; label: string }[]; referral?: unknown } = {},
  ): { system: string; systemDynamic: string } {
    const country = countryFromPhone(contact.phone);
    const memory = memoryText(contact.aiMemory);
    const currency = contactCurrency(contact);
    // Campos personalizados del contacto con valor (los utm_* no son datos del cliente).
    const meta = (contact.metadata && typeof contact.metadata === "object" ? contact.metadata : {}) as Record<string, unknown>;
    const contactFields = (extra.contactFields ?? [])
      .map((f) => ({ ...f, value: meta[f.key] == null ? "" : String(meta[f.key]).trim() }))
      .filter((f) => f.value);
    // {{nombre}}, {{telefono}}, {{pais}}, {{moneda}} y {{clave o nombre de un campo}} en las instrucciones.
    const vars: Record<string, string> = {
      nombre: contact.name ?? "",
      telefono: contact.phone,
      pais: country?.name ?? "",
      moneda: currency ?? "",
    };
    for (const f of contactFields) {
      vars[f.key.toLowerCase()] = f.value;
      vars[f.label.toLowerCase()] = f.value;
    }
    const fill = (text: string) =>
      text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k: string) => {
        const v = vars[k.toLowerCase()];
        return v === undefined ? m : v;
      });
    const where = [
      country ? ` País: ${country.name}.` : "",
      currency ? ` Cotiza en ${currency}.` : "",
    ].join("");
    const fallback =
      "Eres un asistente de atención al cliente por WhatsApp. Responde en español, breve y cordial. Redacta una posible respuesta para que un agente humano la revise antes de enviarla. Si no estás seguro o el caso lo amerita, usa la herramienta handoff_to_human.";
    const system = [
      fill(base ?? fallback),
      extra.catalogFields?.length
        ? `\n\nCada producto del catálogo puede incluir además estos datos: ${extra.catalogFields.join(", ")}. Vienen en search_products (campo «details»): consúltalos y cítalos cuando el cliente pregunte por ellos; nunca inventes su contenido.`
        : "",
      "\n\nSi un mensaje del cliente aparece como [imagen], [documento] o [audio] sin descripción, no pudiste verlo ni oírlo: dilo con naturalidad y pídele que te cuente qué es (o pásalo a una persona si parece un comprobante o un documento importante).",
      splitReplies
        ? "\n\nEscribe como en WhatsApp: mensajes cortos, una idea por párrafo, separados por una línea en blanco (como mucho cuatro párrafos). Cada párrafo se enviará como un mensaje aparte."
        : "",
      // Decir «te paso con una persona» no pasa nada: hay que llamar a la herramienta.
      enabledTools.includes("handoff_to_human")
        ? "\n\nPara pasar el chat a una persona no basta con decirlo: llama a la herramienta handoff_to_human en ese mismo turno (puedes escribir tu despedida y llamarla a la vez). Sin esa llamada, el chat sigue contigo."
        : "",
      "\n\nDevuelve únicamente el texto de la respuesta sugerida, sin prefijos como 'Respuesta:'.",
    ].join("");
    const systemDynamic = [
      `\n\n## Este contacto\nContacto actual: ${contact.name ?? "(sin nombre)"} (${contact.phone}).${where}`,
      contactFields.length
        ? `\n\nDatos guardados de este contacto: ${contactFields.map((f) => `${f.label}: ${f.value}`).join("; ")}.`
        : "",
      memory ? `\n\nLo que sabemos de este cliente (de conversaciones anteriores):\n${memory}` : "",
      originText(extra.referral, meta),
    ].join("");
    return { system, systemDynamic };
  }

  /**
   * Los últimos mensajes del contacto, también de sus conversaciones
   * anteriores (cerradas hace poco): al «cerrar y siguiente» el cliente suele
   * seguir el mismo hilo, y sin ese contexto la IA no sabe de qué habla.
   */
  /**
   * Un mensaje de seguimiento corto para un chat en silencio (lo pide el
   * servicio de seguimientos). Sin herramientas: retoma lo último que se
   * hablaba. null si el modelo no devolvió texto.
   */
  async draftFollowUp(conversationId: string, goal: string): Promise<string | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });
    if (!conversation) return null;
    // Un seguimiento no abre una conversación nueva del cupo si ya está lleno.
    if (!(await this.aiSettings.allowsConversation(conversationId))) return null;
    const config = await this.bots.resolveForConversation(conversation);
    const system = this.buildSystemParts(config?.systemPrompt, conversation.contact, [], false, {
      referral: conversation.referral,
    });
    const history = await this.buildHistory(conversationId);
    const ask =
      "[Nota del sistema, no es un mensaje del cliente] El cliente lleva un tiempo sin responder. Escribe UN solo mensaje de seguimiento, breve (una o dos frases), cálido y sin presionar, que retome lo último que hablaban. No saludes como si fuera el primer contacto ni repitas lo que ya dijiste." +
      (goal.trim() ? ` Objetivo del mensaje: ${goal.trim()}.` : "") +
      " Devuelve solo el texto del mensaje.";
    const res = await this.llm.generate({
      feature: "follow_up",
      system: system.system,
      systemDynamic: system.systemDynamic,
      cacheKey: config?.id ? `agent:${config.id}` : undefined,
      messages: [...history, { role: "user", content: ask }],
      effort: "low",
      maxTokens: 300,
      model: config?.model,
      conversationId,
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim()
      .replace(/^["«]|["»]$/g, "")
      .trim();
    return text || null;
  }

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

/**
 * Por dónde llegó el cliente, para que el agente sepa de qué le habla: el
 * anuncio de Meta que abrió el chat (su titular y su texto) o el formulario
 * de Meta que llenó. "" si no vino de ninguno.
 */
export function originText(referral: unknown, metadata: Record<string, unknown>): string {
  const ad = readAdReferral(referral);
  if (ad) {
    const headline = ad.headline?.trim();
    const body = ad.body?.trim().slice(0, 400);
    const what = [headline ? `titular «${headline}»` : "", body ? `texto «${body}»` : ""].filter(Boolean).join(", ");
    const post = ad.sourceType === "post" ? " (una publicación promocionada)" : "";
    const welcome = ad.welcomeMessage?.trim().slice(0, 300);
    return (
      `\n\n## Cómo llegó\nEste cliente escribió tras tocar un anuncio de Meta${post}${what ? `: ${what}` : ""}.` +
      " Si pregunta por «eso», «el precio» o «lo del anuncio» sin decir qué, se refiere a lo que anunciaba." +
      (welcome ? ` Antes de escribir, WhatsApp le mostró este saludo del anuncio: «${welcome}». No lo repitas.` : "")
    );
  }
  const form = typeof metadata.formulario === "string" ? metadata.formulario.trim() : "";
  if (form) {
    return `\n\n## Cómo llegó\nEste cliente llenó el formulario de Meta «${form}» antes de escribir: ya dejó sus datos, no se los vuelvas a pedir.`;
  }
  return "";
}
