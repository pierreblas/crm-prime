import { Body, Controller, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import { stageWebhookBodySchema, type StageWebhookBody } from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { StageAutomationsService } from "./stage-automations.service";

/**
 * Webhook público de una automatización de etapa («Llega un webhook»). La URL
 * lleva un token secreto propio de la automatización: no hay otra credencial.
 *
 *   POST /api/v1/hooks/stage/<token>
 *   { "phone": "+51999999999" }         ← o "contactId"
 *   { "phone": "...", "vars": { "pedido": "A-123" } }   ← variables para el flujo
 */
@Controller("hooks/stage")
export class StageWebhookController {
  constructor(private readonly automations: StageAutomationsService) {}

  @Post(":token")
  @HttpCode(200)
  async fire(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(stageWebhookBodySchema)) body: StageWebhookBody,
  ) {
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new NotFoundException("Webhook no encontrado");
    const r = await this.automations.onWebhook(token, body);
    return { ok: true, ...r };
  }
}
