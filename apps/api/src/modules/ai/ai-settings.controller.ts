import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import {
  Role,
  updateAiSettingsSchema,
  type AccessTokenClaims,
  type AiConnectionTest,
  type AiSettingEventDto,
  type AiSettingsDto,
  type UpdateAiSettingsInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AiSettingsService } from "./ai-settings.service";
import { AnthropicLLMProvider } from "./providers/anthropic-llm.provider";
import { OpenAILLMProvider } from "./providers/openai-llm.provider";

@Controller("ai/settings")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly openai: OpenAILLMProvider,
    private readonly anthropic: AnthropicLLMProvider,
  ) {}

  @Get()
  get(): Promise<AiSettingsDto> {
    return this.settings.getSettings();
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(updateAiSettingsSchema))
    body: UpdateAiSettingsInput,
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<AiSettingsDto> {
    return this.settings.updateSettings(body, user.sub);
  }

  /** Quién cambió qué en los ajustes de IA, lo más reciente primero. */
  @Get("events")
  events(): Promise<AiSettingEventDto[]> {
    return this.settings.events();
  }

  // Llamada mínima real al proveedor activo para confirmar que la key sirve.
  // El resultado queda en el historial y, si era la clave de la empresa, en su estado.
  @Post("test")
  async test(@CurrentUser() user: AccessTokenClaims): Promise<AiConnectionTest> {
    const resolved = await this.settings.resolve();
    const started = Date.now();

    if (resolved.provider === "fake") {
      return {
        ok: false,
        provider: "fake",
        model: "—",
        message:
          "No hay ninguna API key configurada: las respuestas son simuladas.",
        latencyMs: 0,
      };
    }

    const provider =
      resolved.provider === "openai" ? this.openai : this.anthropic;
    const included = !!resolved.included;
    try {
      const res = await provider.generate({
        system: "Responde únicamente con la palabra: ok",
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 16,
        effort: "low",
        model: resolved.model,
      });
      const latencyMs = Date.now() - started;
      await this.settings.recordTest(
        { ok: true, provider: resolved.provider, model: res.model, latencyMs, included },
        user.sub,
      );
      return {
        ok: true,
        provider: resolved.provider,
        model: res.model,
        message: `Conexión correcta (${res.usage.inputTokens + res.usage.outputTokens} tokens).`,
        latencyMs,
      };
    } catch (e) {
      const latencyMs = Date.now() - started;
      await this.settings.recordTest(
        { ok: false, provider: resolved.provider, model: resolved.model, latencyMs, included, error: e },
        user.sub,
      );
      return {
        ok: false,
        provider: resolved.provider,
        model: resolved.model,
        message: (e as Error).message.slice(0, 300),
        latencyMs,
      };
    }
  }
}
