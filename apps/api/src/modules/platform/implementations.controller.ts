import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  archiveAssessmentSchema,
  createAssessmentSchema,
  crmLinkInputSchema,
  implementationActualInputSchema,
  pricingSettingsSchema,
  quoteActionBodySchema,
  quoteActionSchema,
  updateAssessmentSchema,
  updateQuoteSchema,
  type CreateAssessmentInput,
  type CrmLinkInput,
  type CrmPipeline,
  type CrmSearchResult,
  type ImplementationActualInput,
  type ImplementationAssessment,
  type ImplementationAssessmentRow,
  type ImplementationQuote,
  type PricingSettings,
  type PricingSettingsDto,
  type QuoteAction,
  type QuoteActionBody,
  type UpdateAssessmentInput,
  type UpdateQuoteInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformAdminGuard, type PlatformClaims } from "./platform-admin.guard";
import { ImplementationsService } from "./implementations.service";

/**
 * Cotizador interno de implementaciones. Mismo prefijo y mismo guard que el
 * resto de la consola: solo la cuenta maestra, solo en modo SaaS. Un token de
 * usuario de una empresa no pasa (no lleva purpose: "platform").
 *
 * Las rutas fijas (`implementations/settings`, `quotes/:id/actuals`) van
 * declaradas antes que las de parámetro con las que podrían confundirse.
 */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class ImplementationsController {
  constructor(private readonly svc: ImplementationsService) {}

  private actor(req: Request): string {
    return (req as unknown as { platformClaims?: PlatformClaims }).platformClaims?.email ?? "?";
  }

  // ── Ajustes ────────────────────────────────────────────────

  @Get("implementations/settings")
  settings(): Promise<PricingSettingsDto> {
    return this.svc.settings();
  }

  @Put("implementations/settings")
  updateSettings(@Body(new ZodValidationPipe(pricingSettingsSchema)) body: PricingSettings, @Req() req: Request): Promise<PricingSettingsDto> {
    return this.svc.updateSettings(body, this.actor(req));
  }

  // ── CRM propio ─────────────────────────────────────────────

  /** Embudos y etapas de una empresa (para elegir la etapa de entrada en Ajustes). */
  @Get("implementations/crm/pipelines")
  crmPipelines(@Query("orgId") orgId?: string): Promise<CrmPipeline[]> {
    if (!orgId) throw new BadRequestException("Falta la empresa");
    return this.svc.crmPipelines(orgId);
  }

  /** Oportunidades abiertas y contactos de la empresa propia que coinciden con el texto. */
  @Get("implementations/crm/search")
  crmSearch(@Query("q") q?: string): Promise<CrmSearchResult> {
    return this.svc.crmSearch(q ?? "");
  }

  @Post("implementations/:id/crm-link")
  @HttpCode(200)
  linkCrm(@Param("id") id: string, @Body(new ZodValidationPipe(crmLinkInputSchema)) body: CrmLinkInput, @Req() req: Request): Promise<ImplementationAssessment> {
    return this.svc.linkCrm(id, body, this.actor(req));
  }

  @Delete("implementations/:id/crm-link")
  unlinkCrm(@Param("id") id: string, @Req() req: Request): Promise<ImplementationAssessment> {
    return this.svc.unlinkCrm(id, this.actor(req));
  }

  // ── Diagnósticos ───────────────────────────────────────────

  @Get("implementations")
  list(@Query("search") search?: string, @Query("archived") archived?: string): Promise<ImplementationAssessmentRow[]> {
    return this.svc.list(search ?? "", archived === "1" || archived === "true");
  }

  @Post("implementations")
  create(@Body(new ZodValidationPipe(createAssessmentSchema)) body: CreateAssessmentInput, @Req() req: Request): Promise<ImplementationAssessment> {
    return this.svc.create(body, this.actor(req));
  }

  @Get("implementations/:id")
  get(@Param("id") id: string): Promise<ImplementationAssessment> {
    return this.svc.get(id);
  }

  @Patch("implementations/:id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAssessmentSchema)) body: UpdateAssessmentInput,
    @Req() req: Request,
  ): Promise<ImplementationAssessment> {
    return this.svc.update(id, body, this.actor(req));
  }

  @Post("implementations/:id/archive")
  @HttpCode(200)
  archive(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(archiveAssessmentSchema)) body: { archived: boolean },
    @Req() req: Request,
  ): Promise<ImplementationAssessment> {
    return this.svc.archive(id, body.archived, this.actor(req));
  }

  /** Primera versión de la cotización del diagnóstico. */
  @Post("implementations/:id/quotes")
  @HttpCode(200)
  createQuote(@Param("id") id: string, @Req() req: Request): Promise<ImplementationQuote> {
    return this.svc.createQuote(id, this.actor(req));
  }

  // ── Cotizaciones ───────────────────────────────────────────

  @Get("quotes/:id")
  getQuote(@Param("id") id: string): Promise<ImplementationQuote> {
    return this.svc.getQuote(id);
  }

  @Patch("quotes/:id")
  updateQuote(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateQuoteSchema)) body: UpdateQuoteInput,
    @Req() req: Request,
  ): Promise<ImplementationQuote> {
    return this.svc.updateQuote(id, body, this.actor(req));
  }

  /** Horas y costos reales sobre la versión aceptada. */
  @Post("quotes/:id/actuals")
  @HttpCode(200)
  addActual(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(implementationActualInputSchema)) body: ImplementationActualInput,
    @Req() req: Request,
  ): Promise<ImplementationQuote> {
    return this.svc.addActual(id, body, this.actor(req));
  }

  @Delete("quotes/:id/actuals/:actualId")
  removeActual(@Param("id") id: string, @Param("actualId") actualId: string, @Req() req: Request): Promise<ImplementationQuote> {
    return this.svc.removeActual(id, actualId, this.actor(req));
  }

  /** submit | reopen | approve | send | accept | reject | cancel | revise */
  @Post("quotes/:id/:action")
  @HttpCode(200)
  act(
    @Param("id") id: string,
    @Param("action", new ZodValidationPipe(quoteActionSchema)) action: QuoteAction,
    @Body(new ZodValidationPipe(quoteActionBodySchema)) body: QuoteActionBody,
    @Req() req: Request,
  ): Promise<ImplementationQuote> {
    return this.svc.act(id, action, body, this.actor(req));
  }
}
