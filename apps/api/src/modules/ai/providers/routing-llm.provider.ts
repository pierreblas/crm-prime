import { Injectable, Logger } from "@nestjs/common";
import type { Classification } from "@crm/shared";
import { AiSettingsService } from "../ai-settings.service";
import { AiUsageService } from "../ai-usage.service";
import type { LLMProvider } from "../llm.provider";
import type { LlmRequest, LlmResponse } from "../llm.types";
import { AnthropicLLMProvider } from "./anthropic-llm.provider";
import { FakeLLMProvider } from "./fake-llm.provider";
import { OpenAILLMProvider } from "./openai-llm.provider";

/**
 * Proveedor que decide el adaptador real en cada llamada, no al arrancar.
 * Así, cambiar la key o el proveedor en Ajustes › Inteligencia Artificial
 * surte efecto de inmediato, sin reiniciar la API ni el worker.
 *
 * `name` es el del último adaptador usado (lo muestran el playground y el
 * copilot); antes de la primera llamada refleja lo que hay configurado.
 */
@Injectable()
export class RoutingLLMProvider implements LLMProvider {
  private readonly logger = new Logger("LLM");
  private lastUsed = "fake";

  constructor(
    private readonly settings: AiSettingsService,
    private readonly openai: OpenAILLMProvider,
    private readonly anthropic: AnthropicLLMProvider,
    private readonly fake: FakeLLMProvider,
    private readonly usage: AiUsageService,
  ) {}

  get name(): string {
    return this.lastUsed;
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const provider = await this.pick(req.model);
    const res = await provider.generate(req);
    this.usage.record({
      feature: req.feature ?? "agent",
      model: res.model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      conversationId: req.conversationId,
      // Quién pagó lo dice el adaptador, que sabe qué credencial usó.
      billingMode: res.billingMode,
      requestId: res.requestId,
    });
    return res;
  }

  async classify(text: string): Promise<Classification> {
    const provider = await this.pick();
    return provider.classify(text);
  }

  // El modelo pedido por el bot puede decidir el proveedor cuando la
  // configuración está en "auto" y hay más de una credencial disponible.
  private async pick(requestedModel?: string): Promise<LLMProvider> {
    const resolved = await this.settings.resolve();
    let target = resolved.provider;

    if (requestedModel) {
      const wants = /^claude/i.test(requestedModel)
        ? "anthropic"
        : /^(gpt-|o[134]|chatgpt)/i.test(requestedModel)
          ? "openai"
          : null;
      if (wants && wants !== target) {
        const alt = await this.settings.resolveFor(wants);
        if (alt.apiKey) target = wants;
      }
    }

    const provider =
      target === "openai"
        ? this.openai
        : target === "anthropic"
          ? this.anthropic
          : this.fake;

    if (provider.name !== this.lastUsed) {
      this.lastUsed = provider.name;
      const note =
        provider.name === "fake"
          ? " (simulado — configura una API key en Ajustes › Inteligencia Artificial)"
          : "";
      this.logger.log(`LLM activo: ${provider.name}${note}`);
    }
    return provider;
  }
}
