import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createCampaignSchema,
  createTemplateSchema,
  updateCampaignSchema,
  updateTemplateSchema,
  Role,
  campaignAudienceSchema,
  campaignTestSchema,
  tagRespondersSchema,
  type CampaignAudience,
  type CampaignTestInput,
  type TagRespondersInput,
  type CreateCampaignInput,
  type CreateTemplateInput,
  type UpdateCampaignInput,
  type UpdateTemplateInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { TemplateService } from "./template.service";
import { CampaignService } from "./campaign.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(
    private readonly templates: TemplateService,
    private readonly campaigns: CampaignService,
  ) {}

  // ── Plantillas ─────────────────────────────────────────────
  @Get("templates")
  listTemplates() {
    return this.templates.list();
  }

  @Post("templates")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  createTemplate(
    @Body(new ZodValidationPipe(createTemplateSchema)) body: CreateTemplateInput,
  ) {
    return this.templates.create(body);
  }

  @Patch("templates/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  updateTemplate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateInput,
  ) {
    return this.templates.update(id, body);
  }

  @Delete("templates/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  removeTemplate(@Param("id") id: string) {
    return this.templates.remove(id);
  }

  // Trae del panel de Meta las plantillas ya creadas (y sus estados).
  @Post("templates/sync")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  syncTemplates() {
    return this.templates.importFromMeta();
  }

  // ── Campañas ───────────────────────────────────────────────
  @Get("campaigns/meta")
  meta() {
    return this.campaigns.meta();
  }

  @Get("campaigns/audience")
  audience(@Query("tagIds") tagIds?: string) {
    const ids = tagIds ? tagIds.split(",").filter(Boolean) : [];
    return this.campaigns.audiencePreview(ids);
  }

  /** Recuento de la audiencia con todos los filtros (el asistente lo pide al vuelo). */
  @Post("campaigns/audience-count")
  @HttpCode(200)
  audienceCount(@Body(new ZodValidationPipe(campaignAudienceSchema)) body: CampaignAudience) {
    return this.campaigns.audienceCount(body);
  }

  /** La plantilla tal cual, a un número (el tuyo) antes de lanzar. */
  @Post("campaigns/test")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  sendTest(@Body(new ZodValidationPipe(campaignTestSchema)) body: CampaignTestInput) {
    return this.campaigns.sendTest(body);
  }

  @Get("campaigns/:id/recipients")
  recipients(@Param("id") id: string) {
    return this.campaigns.recipients(id);
  }

  @Post("campaigns/:id/retry-failed")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  retryFailed(@Param("id") id: string) {
    return this.campaigns.retryFailed(id);
  }

  @Post("campaigns/:id/tag-responders")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  tagResponders(@Param("id") id: string, @Body(new ZodValidationPipe(tagRespondersSchema)) body: TagRespondersInput) {
    return this.campaigns.tagResponders(id, body.tag);
  }

  @Post("campaigns/:id/duplicate")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  duplicate(@Param("id") id: string) {
    return this.campaigns.duplicate(id);
  }

  @Get("campaigns")
  list() {
    return this.campaigns.list();
  }

  @Get("campaigns/:id")
  get(@Param("id") id: string) {
    return this.campaigns.getById(id);
  }

  @Post("campaigns")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  create(
    @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignInput,
  ) {
    return this.campaigns.create(body);
  }

  @Patch("campaigns/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignInput,
  ) {
    return this.campaigns.update(id, body);
  }

  @Post("campaigns/:id/launch")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  launch(@Param("id") id: string) {
    return this.campaigns.launch(id);
  }

  @Post("campaigns/:id/cancel")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  cancel(@Param("id") id: string) {
    return this.campaigns.cancel(id);
  }

  @Delete("campaigns/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param("id") id: string) {
    return this.campaigns.remove(id);
  }
}
