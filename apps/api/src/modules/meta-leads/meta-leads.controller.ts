import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  connectMetaPagesSchema,
  convertMetaLeadSchema,
  metaPagesAvailableSchema,
  updateMetaPageSchema,
  Role,
  type ConnectMetaPagesInput,
  type ConvertMetaLeadInput,
  type MetaLeadStatusValue,
  type MetaPagesAvailableInput,
  type UpdateMetaPageInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { MetaPageService } from "./meta-page.service";
import { MetaLeadService } from "./meta-lead.service";

// Conectar páginas y revisar los leads es tarea de quien administra el CRM.
@Controller("meta")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class MetaLeadsController {
  constructor(
    private readonly pages: MetaPageService,
    private readonly leads: MetaLeadService,
  ) {}

  // ── Páginas ────────────────────────────────────────────────
  @Get("pages")
  listPages() {
    return this.pages.list();
  }

  /** Paso 1 del login de Facebook: qué páginas administra el usuario. */
  @Post("pages/available")
  available(
    @Body(new ZodValidationPipe(metaPagesAvailableSchema))
    body: MetaPagesAvailableInput,
  ) {
    return this.pages.available(body);
  }

  /** Paso 2: guardar y suscribir las páginas elegidas. */
  @Post("pages/connect")
  connect(
    @Body(new ZodValidationPipe(connectMetaPagesSchema))
    body: ConnectMetaPagesInput,
  ) {
    return this.pages.connect(body.sessionId, body.pageIds);
  }

  @Patch("pages/:id")
  updatePage(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMetaPageSchema))
    body: UpdateMetaPageInput,
  ) {
    return this.pages.update(id, body);
  }

  @Post("pages/:id/resubscribe")
  resubscribe(@Param("id") id: string) {
    return this.pages.resubscribe(id);
  }

  @Delete("pages/:id")
  disconnect(@Param("id") id: string) {
    return this.pages.disconnect(id);
  }

  // ── Leads ──────────────────────────────────────────────────
  @Get("leads")
  listLeads(@Query("status") status?: MetaLeadStatusValue) {
    return this.leads.listLeads(status);
  }

  /** Convierte en contacto un lead que llegó sin teléfono. */
  @Post("leads/:id/convert")
  convert(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(convertMetaLeadSchema))
    body: ConvertMetaLeadInput,
  ) {
    return this.leads.convertLead(id, body.phone);
  }

  @Delete("leads/:id")
  discard(@Param("id") id: string) {
    return this.leads.discardLead(id);
  }
}
