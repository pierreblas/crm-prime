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
  metaSessionFormsSchema,
  updateMetaPageSchema,
  Role,
  type ConnectMetaPagesInput,
  type ConvertMetaLeadInput,
  type MetaLeadStatusValue,
  type MetaPagesAvailableInput,
  type MetaSessionFormsInput,
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

  /** Entre el 1 y el 2: los formularios de las páginas elegidas, para marcar cuáles entran. */
  @Post("pages/available/forms")
  sessionForms(
    @Body(new ZodValidationPipe(metaSessionFormsSchema))
    body: MetaSessionFormsInput,
  ) {
    return this.pages.sessionForms(body.sessionId, body.pageIds);
  }

  /** Paso 2: guardar y suscribir las páginas elegidas (y qué formularios entran). */
  @Post("pages/connect")
  connect(
    @Body(new ZodValidationPipe(connectMetaPagesSchema))
    body: ConnectMetaPagesInput,
  ) {
    return this.pages.connect(body.sessionId, body.pageIds, body.enable, body.forms, body.newFormsEnter);
  }

  @Patch("pages/:id")
  updatePage(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMetaPageSchema))
    body: UpdateMetaPageInput,
  ) {
    return this.pages.update(id, body);
  }

  /** Formularios de la página con su regla (importar y a qué etapa). */
  @Get("pages/:id/forms")
  forms(@Param("id") id: string) {
    return this.pages.forms(id);
  }

  /** Preguntas de un formulario, para elegir a dónde va cada respuesta. */
  @Get("pages/:id/forms/:formId/questions")
  questions(@Param("id") id: string, @Param("formId") formId: string) {
    return this.pages.questions(id, formId);
  }

  /** Trae los leads anteriores del formulario (los que Meta aún guarda, 90 días). */
  @Post("pages/:id/forms/:formId/import")
  importForm(@Param("id") id: string, @Param("formId") formId: string) {
    return this.pages.importForm(id, formId);
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
  listLeads(@Query("status") status?: MetaLeadStatusValue, @Query("pageId") pageId?: string, @Query("formId") formId?: string) {
    return this.leads.listLeads({ status, pageId, formId });
  }

  /** Vuelve a pasar un lead con la configuración actual del formulario. */
  @Post("leads/:id/reprocess")
  reprocess(@Param("id") id: string) {
    return this.leads.reprocessLead(id);
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
