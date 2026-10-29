import { Injectable, Logger } from "@nestjs/common";
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

// Formas mínimas de la API de OpenAI (Chat Completions) que usamos.
interface OaiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}
interface OaiResponse {
  model: string;
  choices: {
    finish_reason: string;
    message: { content: string | null; tool_calls?: OaiToolCall[] };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/**
 * Adaptador de OpenAI (Chat Completions API) vía fetch, sin SDK.
 *
 * La API key, el modelo por defecto y la URL base se resuelven en cada
 * llamada desde Ajustes › Inteligencia Artificial (BD, con respaldo en
 * OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL del entorno), para que
 * cambiarlos en la UI surta efecto sin reiniciar la API.
 *
 * Traduce nuestro formato provider-agnóstico (bloques text / tool_use /
 * tool_result) al de OpenAI (tool_calls + mensajes role:"tool").
 */
@Injectable()
export class OpenAILLMProvider implements LLMProvider {
  readonly name = "openai";
  private readonly logger = new Logger("OpenAILLM");

  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
  ) {}

  private async config(): Promise<{
    apiKey: string;
    model: string;
    baseUrl: string;
    included: boolean;
  }> {
    const c = await this.settings.resolveFor("openai");
    if (!c.apiKey) {
      throw new Error(
        "Falta la API key de OpenAI. Configúrala en Ajustes › Inteligencia Artificial.",
      );
    }
    return {
      apiKey: c.apiKey,
      model: c.model || env("OPENAI_MODEL") || "gpt-4o-mini",
      baseUrl:
        c.baseUrl ?? env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
      included: !!c.included,
    };
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const cfg = await this.config();
    // Lo fijo primero y lo variable (contacto, conocimiento) al final: OpenAI
    // cachea el prefijo idéntico a partir de 1.024 tokens y cobra la mitad.
    const knowledgeText = req.knowledge?.length
      ? `\n\n## Base de conocimiento relevante\nUsa esta información para responder. Si no es suficiente, dilo o escala.\n${req.knowledge
          .map((k, i) => `[${i + 1}] ${k}`)
          .join("\n")}`
      : "";
    const systemText = `${req.system}${req.systemDynamic ?? ""}${knowledgeText}`;

    const messages: OaiMessage[] = [
      { role: "system", content: systemText },
      ...this.toOaiMessages(req.messages),
    ];

    // Con la IA de Driony el modelo es fijo: el del bot solo vale con clave propia.
    const model = cfg.included ? cfg.model : this.resolveModel(req.model, cfg.model);
    const body: Record<string, unknown> = {
      model,
      ...outputLimit(model, req.maxTokens ?? 1024, cfg.included ? "low" : req.effort),
      messages,
      ...(req.cacheKey ? { prompt_cache_key: req.cacheKey } : {}),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const data = await this.call<OaiResponse>("/chat/completions", body, cfg);
    // Cuántos tokens de entrada vinieron de la caché del prompt (a mitad de precio).
    this.logger.debug(
      `${data.model}: ${data.usage?.prompt_tokens ?? 0} in (${data.usage?.prompt_tokens_details?.cached_tokens ?? 0} de caché), ${data.usage?.completion_tokens ?? 0} out`,
    );
    const choice = data.choices[0];
    const msg = choice?.message;

    const content: LlmContentBlock[] = [];
    if (msg?.content) content.push({ type: "text", text: msg.content });
    for (const tc of msg?.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }

    return {
      stopReason: this.mapStop(choice?.finish_reason),
      content,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      model: data.model ?? cfg.model,
    };
  }

  async classify(text: string): Promise<Classification> {
    const fallback: Classification = {
      intent: "general",
      sentiment: "neutral",
      urgency: "low",
      requiresHuman: false,
    };
    try {
      const cfg = await this.config();
      const data = await this.call<OaiResponse>("/chat/completions", {
        model: cfg.model,
        ...outputLimit(cfg.model, 256, "low"),
        messages: [
          {
            role: "system",
            content:
              "Clasifica el último mensaje del cliente. Responde solo con el JSON pedido.",
          },
          { role: "user", content: text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "classification",
            strict: true,
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
      }, cfg);
      this.usage.record({
        feature: "classify",
        model: data.model ?? cfg.model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      });
      const raw = data.choices[0]?.message?.content ?? "{}";
      return { ...fallback, ...(JSON.parse(raw) as Partial<Classification>) };
    } catch (e) {
      this.logger.warn(`Clasificación OpenAI falló: ${(e as Error).message}`);
      return fallback;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  // Usa el modelo pedido por el bot solo si es de OpenAI; si el bot tiene un
  // modelo de otro proveedor (p. ej. claude-*), cae al modelo configurado.
  private resolveModel(requested: string | undefined, fallback: string): string {
    if (requested && /^(gpt-|o[134]|chatgpt)/i.test(requested)) return requested;
    return fallback;
  }

  private async call<T>(
    path: string,
    body: unknown,
    cfg: { apiKey: string; baseUrl: string },
  ): Promise<T> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  // Aplana nuestros mensajes (con bloques) al formato de OpenAI: los
  // tool_result se convierten en mensajes role:"tool" independientes.
  private toOaiMessages(messages: LlmMessage[]): OaiMessage[] {
    const out: OaiMessage[] = [];
    for (const m of messages) {
      if (typeof m.content === "string") {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      if (m.role === "assistant") {
        const text = m.content
          .filter((b): b is Extract<LlmAnyBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("");
        const toolCalls: OaiToolCall[] = m.content
          .filter((b): b is Extract<LlmAnyBlock, { type: "tool_use" }> => b.type === "tool_use")
          .map((b) => ({
            id: b.id,
            type: "function" as const,
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          }));
        out.push({
          role: "assistant",
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
      } else {
        // role "user" con bloques → suele ser tool_result(s).
        for (const b of m.content) {
          if (b.type === "tool_result") {
            out.push({
              role: "tool",
              tool_call_id: b.tool_use_id,
              content: b.content,
            });
          } else if (b.type === "text") {
            out.push({ role: "user", content: b.text });
          }
        }
      }
    }
    return out;
  }

  private mapStop(reason?: string): LlmResponse["stopReason"] {
    switch (reason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "content_filter":
        return "refusal";
      case "stop":
        return "end_turn";
      default:
        return reason ?? "end_turn";
    }
  }
}

/**
 * Límite de salida según la familia del modelo. Los de razonamiento (gpt-5,
 * o1/o3/o4) rechazan max_tokens: piden max_completion_tokens, que además
 * incluye el razonamiento interno, así que se deja margen para que no se coma
 * la respuesta. El esfuerzo del bot (low…max) se traduce a reasoning_effort.
 */
export function outputLimit(model: string, max: number, effort?: string): Record<string, unknown> {
  if (!/^(gpt-5|o[134])/i.test(model)) return { max_tokens: max };
  const reasoning = effort === "low" ? "low" : effort === "high" || effort === "xhigh" || effort === "max" ? "high" : "medium";
  return { max_completion_tokens: max + 4096, reasoning_effort: reasoning };
}
