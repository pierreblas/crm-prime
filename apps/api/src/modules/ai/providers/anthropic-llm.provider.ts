import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { Classification } from "@crm/shared";
import { env } from "../../../common/utils/env";
import { AiSettingsService } from "../ai-settings.service";
import type { LLMProvider } from "../llm.provider";
import type {
  LlmAnyBlock,
  LlmContentBlock,
  LlmMessage,
  LlmRequest,
  LlmResponse,
} from "../llm.types";
import { AiUsageService } from "../ai-usage.service";

/**
 * Adaptador real de la API de Claude (Anthropic).
 *
 * La API key y el modelo por defecto se resuelven en cada llamada desde
 * Ajustes › Inteligencia Artificial (BD, con respaldo en ANTHROPIC_API_KEY /
 * ANTHROPIC_MODEL del entorno), para que cambiarlos en la UI surta efecto
 * sin reiniciar la API.
 *
 * Notas de diseño:
 * - Streaming + finalMessage() para evitar timeouts en respuestas largas.
 * - Prompt caching del system prompt (cache_control ephemeral).
 * - No se habilita thinking en el bucle de herramientas en esta iteración
 *   (evita tener que reenviar los bloques de thinking sin modificar entre
 *   turnos). Se controla la profundidad con output_config.effort.
 */
@Injectable()
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly logger = new Logger("AnthropicLLM");

  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
  ) {}

  private async config(): Promise<{ client: Anthropic; model: string }> {
    const c = await this.settings.resolveFor("anthropic");
    if (!c.apiKey) {
      throw new Error(
        "Falta la API key de Anthropic. Configúrala en Ajustes › Inteligencia Artificial.",
      );
    }
    return {
      client: new Anthropic({ apiKey: c.apiKey }),
      model: c.model || env("ANTHROPIC_MODEL") || "claude-opus-4-8",
    };
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const cfg = await this.config();
    // Cuerpo construido de forma laxa: algunos parámetros (output_config)
    // pueden no estar en los tipos del SDK según la versión instalada.
    // Dos bloques: el fijo (cacheado) y, aparte, lo de este contacto y el
    // conocimiento recuperado, que cambian en cada llamada y no deben romper la caché.
    const knowledgeText = req.knowledge?.length
      ? `\n\n## Base de conocimiento relevante\nUsa esta información para responder. Si no es suficiente, dilo o escala.\n${req.knowledge.map((k, i) => `[${i + 1}] ${k}`).join("\n")}`
      : "";
    const dynamicText = `${req.systemDynamic ?? ""}${knowledgeText}`;

    const body: Record<string, unknown> = {
      model: this.resolveModel(req.model, cfg.model),
      max_tokens: req.maxTokens ?? 1024,
      system: [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" },
        },
        ...(dynamicText ? [{ type: "text", text: dynamicText }] : []),
      ],
      output_config: { effort: req.effort ?? "medium" },
      messages: req.messages.map((m) => this.toSdkMessage(m)),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    const stream = cfg.client.messages.stream(
      body as unknown as Anthropic.MessageStreamParams,
    );
    const msg = await stream.finalMessage();
    // Cuántos tokens de entrada se leyeron de la caché (al 10 % del precio) y cuántos la crearon.
    this.logger.debug(
      `${msg.model}: ${msg.usage.input_tokens} in + ${msg.usage.cache_read_input_tokens ?? 0} de caché + ${msg.usage.cache_creation_input_tokens ?? 0} a caché, ${msg.usage.output_tokens} out`,
    );

    const content: LlmContentBlock[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      stopReason: msg.stop_reason ?? "end_turn",
      content,
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      },
      model: msg.model,
    };
  }

  async classify(text: string): Promise<Classification> {
    const cfg = await this.config();
    // Salida estructurada (output_config.format) para una clasificación fiable.
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: 256,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              intent: { type: "string" },
              sentiment: {
                type: "string",
                enum: ["positive", "neutral", "negative"],
              },
              urgency: { type: "string", enum: ["low", "medium", "high"] },
              requiresHuman: { type: "boolean" },
            },
            required: ["intent", "sentiment", "urgency", "requiresHuman"],
            additionalProperties: false,
          },
        },
      },
      system:
        "Clasifica el último mensaje del cliente. Responde solo con el JSON pedido.",
      messages: [{ role: "user", content: text }],
    };
    const msg = await cfg.client.messages.create(
      body as unknown as Anthropic.MessageCreateParamsNonStreaming,
    );
    this.usage.record({
      feature: "classify",
      model: msg.model,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    });
    const block = msg.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "{}";
    try {
      return JSON.parse(raw) as Classification;
    } catch {
      return {
        intent: "general",
        sentiment: "neutral",
        urgency: "low",
        requiresHuman: false,
      };
    }
  }

  // Usa el modelo pedido por el bot solo si es de Anthropic (claude-*); si no,
  // cae al modelo configurado por defecto.
  private resolveModel(requested: string | undefined, fallback: string): string {
    if (requested && /^claude/i.test(requested)) return requested;
    return fallback;
  }

  private toSdkMessage(m: LlmMessage): Anthropic.MessageParam {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const blocks = m.content.map((b: LlmAnyBlock) => {
      if (b.type === "text") return { type: "text" as const, text: b.text };
      if (b.type === "tool_use")
        return {
          type: "tool_use" as const,
          id: b.id,
          name: b.name,
          input: b.input,
        };
      return {
        type: "tool_result" as const,
        tool_use_id: b.tool_use_id,
        content: b.content,
      };
    });
    return { role: m.role, content: blocks as Anthropic.ContentBlockParam[] };
  }
}
