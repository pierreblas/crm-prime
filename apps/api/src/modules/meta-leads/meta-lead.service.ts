import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Prisma } from "@prisma/client";
import {
  countryFromPhone,
  dialCodeOf,
  mapMetaLeadFields,
  parseMetaFormRules,
  phoneWithDefaultCountry,
  MessageAuthor,
  type MetaLeadDto,
  type MetaLeadField,
  type MetaLeadStatusValue,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runAsActor } from "../../infra/tenant/actor";
import { TenantService } from "../../infra/tenant/tenant.service";
import { LeadService } from "../leads/lead.service";
import { MessagingService } from "../messaging/messaging.service";
import { decideIntake } from "../pipeline/intake";
import { fuenteAutomatica, fuenteAutomaticaExistente } from "../sources/fuente-automatica";
import { MetaGraphClient } from "./meta-graph.client";

/** Lo que el lead necesita de su página para decidir qué hacer. */
type LeadPage = {
  // Los leads llegan por webhook de Meta, sin petición del usuario detrás.
  // La empresa sale de la página conectada, que es quien recibió el lead.
  orgId: string;
  pageId: string;
  name: string;
  sourceId: string | null;
  tagIds: unknown;
  createDeal: boolean;
  dealStageId: string | null;
  formRules: unknown;
  welcomeTemplateId: string | null;
};

export interface LeadgenNotification {
  leadgenId: string;
  pageId: string;
  formId?: string;
  adId?: string;
}

/**
 * Procesa un lead de un formulario de Meta: lo descarga, crea o actualiza el
 * contacto y, según la configuración de la página, abre una oportunidad y
 * manda la plantilla de bienvenida por WhatsApp.
 */
@Injectable()
export class MetaLeadService {
  private readonly logger = new Logger("MetaLeads");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly graph: MetaGraphClient,
    private readonly leads: LeadService,
    private readonly messaging: MessagingService,
    private readonly events: EventEmitter2,
  ) {}

  /** La regla de ese formulario en la página, si la tiene. */
  private ruleFor(page: LeadPage, formId: string | null | undefined) {
    return formId ? parseMetaFormRules(page.formRules).find((r) => r.formId === formId) : undefined;
  }

  /**
   * Dónde va la oportunidad del lead: la etapa elegida para su formulario, la
   * de la página o ninguna. `stageId` null = primera del embudo predeterminado.
   */
  private dealTarget(page: LeadPage, formId: string | null | undefined): { stageId: string | null } | null {
    const rule = this.ruleFor(page, formId);
    if (rule?.stage === "none") return null;
    if (rule && rule.stage !== "page") return { stageId: rule.stage };
    return page.createDeal ? { stageId: page.dealStageId } : null;
  }

  async processNotification(note: LeadgenNotification): Promise<void> {
    // Meta reintenta el webhook si tardamos: no dupliques el lead.
    const already = await this.prisma.metaLead.findUnique({
      where: { leadgenId: note.leadgenId },
    });
    if (already) {
      this.logger.debug(`Lead ${note.leadgenId} ya procesado`);
      return;
    }

    const page = await this.prisma.metaPage.findUnique({
      where: { pageId: note.pageId },
    });
    if (!page || !page.isActive) {
      this.logger.warn(
        `Lead de una página no conectada (${note.pageId}): se ignora`,
      );
      return;
    }
    // Formulario apagado en Ajustes: sus leads no entran.
    if (this.ruleFor(page, note.formId)?.enabled === false) {
      this.logger.log(`Lead ${note.leadgenId} del formulario ${note.formId}, desactivado: se ignora`);
      return;
    }

    let detail;
    try {
      detail = await this.graph.getLead(note.leadgenId, page.accessToken);
    } catch (e) {
      // Se deja constancia: el lead existe en Meta aunque no podamos leerlo.
      await this.record(note, page.pageId, [], {
        status: "ERROR",
        error: (e as Error).message.slice(0, 300),
      });
      throw e;
    }

    // El aviso de Meta puede no traer el formulario: con el del lead se mira otra vez.
    if (!note.formId && this.ruleFor(page, detail.formId)?.enabled === false) {
      this.logger.log(`Lead ${note.leadgenId} del formulario ${detail.formId}, desactivado: se ignora`);
      return;
    }

    const mapped = mapMetaLeadFields(detail.fields, this.ruleFor(page, detail.formId ?? note.formId)?.fieldMap);
    const [formName, adInfo] = await Promise.all([
      detail.formId ? this.graph.getFormName(detail.formId, page.accessToken) : null,
      this.graph.getLeadAdInfo(note.leadgenId, page.accessToken),
    ]);
    const ad = { adName: adInfo?.adName ?? null, campaignName: adInfo?.campaignName ?? null, platform: adInfo?.platform ?? null };

    // Sin teléfono no se puede crear el contacto (es su identificador), así
    // que el lead queda en la bandeja de pendientes para revisarlo a mano.
    if (!mapped.phone) {
      await this.record(
        { ...note, formId: detail.formId ?? undefined },
        page.pageId,
        detail.fields,
        { status: "NO_PHONE", formName, ...ad, ...mapped },
      );
      this.logger.log(`Lead ${note.leadgenId} sin teléfono: queda pendiente`);
      return;
    }

    const contactId = await this.createContact(page, mapped, formName, ad, detail.formId ?? note.formId ?? null);

    await this.record(
      { ...note, formId: detail.formId ?? undefined },
      page.pageId,
      detail.fields,
      { status: "PROCESSED", formName, ...ad, ...mapped, contactId },
    );
    this.logger.log(
      `Lead ${note.leadgenId} → contacto ${contactId} (${page.name})`,
    );
  }

  /** Crea/actualiza el contacto y dispara las acciones de la página. */
  private async createContact(
    page: LeadPage,
    mapped: ReturnType<typeof mapMetaLeadFields>,
    formName: string | null,
    ad: { adName: string | null; campaignName: string | null } = { adName: null, campaignName: null },
    formId: string | null = null,
  ): Promise<string> {
    // Fuente: la del formulario si la tiene («auto» = la automática); si no, o
    // si ya no existe, la de la página. Etiquetas: las de los dos.
    const rule = this.ruleFor(page, formId);
    const formSourceId = rule && rule.source !== "page" && rule.source !== "auto" ? rule.source : null;
    const source =
      rule?.source === "auto"
        ? null
        : ((formSourceId && (await this.prisma.source.findUnique({ where: { id: formSourceId } }))) ||
          (page.sourceId ? await this.prisma.source.findUnique({ where: { id: page.sourceId } }) : null));
    const tagIds = [...new Set([...(Array.isArray(page.tagIds) ? (page.tagIds as string[]) : []), ...(rule?.tagIds ?? [])])];
    const tags = tagIds.length
      ? await this.prisma.tag.findMany({ where: { id: { in: tagIds } } })
      : [];

    const fields = { ...mapped.extra };
    if (mapped.email) fields.email = mapped.email;
    if (formName) fields.formulario = formName;
    if (ad.adName) fields.anuncio = ad.adName;
    if (ad.campaignName) fields.campana = ad.campaignName;

    const { id: contactId } = await this.leads.ingestLead(
      {
        // Sin prefijo de país, el del número de WhatsApp de la empresa: así el
        // lead y su chat de WhatsApp son el mismo contacto.
        phone: phoneWithDefaultCountry(mapped.phone!, await this.defaultDialCode()),
        name: mapped.name ?? undefined,
        source: source?.name,
        tags: tags.map((t) => t.name),
        fields,
        integration: `Meta · ${page.name}`,
      },
      `Meta Lead Ads · ${page.name}`,
      { via: "meta", formName, formId },
    );
    if (!source) await this.formSource(page.orgId, contactId);

    const target = this.dealTarget(page, formId);
    if (target) {
      await runAsActor("system:meta", () => this.createDeal(page.orgId, contactId, mapped.name, formName, target.stageId));
    }
    if (page.welcomeTemplateId) {
      await this.sendWelcome(page.orgId, contactId, page.welcomeTemplateId);
    }

    return contactId;
  }

  /**
   * Página sin fuente elegida: la automática «Formulario de Facebook». Solo si
   * el contacto no tiene fuente o tiene la automática «WhatsApp» (escribió por
   * el botón del formulario antes de que llegara el lead): una puesta a mano
   * se respeta.
   */
  private async formSource(orgId: string, contactId: string): Promise<void> {
    const formId = await fuenteAutomatica(this.prisma, orgId, "form");
    const whatsappId = await fuenteAutomaticaExistente(this.prisma, orgId, "whatsapp");
    await this.prisma.contact.updateMany({
      where: {
        id: contactId,
        OR: [{ sourceId: null }, ...(whatsappId ? [{ sourceId: whatsappId }] : [])],
      },
      data: { sourceId: formId },
    });
  }

  /** Prefijo del país del número de WhatsApp principal de la empresa («51»), o null. */
  private async defaultDialCode(): Promise<string | null> {
    const conn = await this.prisma.whatsappConnection.findFirst({
      where: { isActive: true, displayPhoneNumber: { not: null } },
      orderBy: { connectedAt: "asc" },
      select: { displayPhoneNumber: true },
    });
    const country = countryFromPhone(conn?.displayPhoneNumber);
    return country ? dialCodeOf(country.code) : null;
  }

  /**
   * Oportunidad en la etapa elegida (sin ella o si ya no existe, la primera
   * del embudo predeterminado). Como la entrada desde WhatsApp: si el cliente
   * ya tiene una en curso no se duplica, y una descartada por inactividad en
   * ese embudo vuelve. Avisa del cambio de etapa para que corran sus
   * automatizaciones, conversiones y flujos.
   */
  private async createDeal(
    orgId: string,
    contactId: string,
    name: string | null,
    formName: string | null,
    stageId: string | null,
  ): Promise<void> {
    const select = { id: true, pipelineId: true } as const;
    const stage =
      (stageId ? await this.prisma.pipelineStage.findUnique({ where: { id: stageId }, select }) : null) ??
      (await this.prisma.pipelineStage.findFirst({ where: { pipeline: { isDefault: true } }, orderBy: { order: "asc" }, select }));
    if (!stage) {
      this.logger.warn("No hay etapas en el pipeline: no se creó la oportunidad");
      return;
    }

    const last = await this.prisma.deal.findFirst({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      include: { stage: { select: { isWon: true, isLost: true, pipelineId: true } } },
    });
    const decision = decideIntake(last, stage.pipelineId);
    if (decision === "skip") {
      this.logger.log(`El contacto ${contactId} ya tiene una oportunidad en curso: no se crea otra`);
      return;
    }

    try {
      const dealId =
        decision === "restore" && last
          ? (
              await this.prisma.deal.update({
                where: { id: last.id },
                data: { discardedAt: null, discardReason: null, stageId: stage.id },
              })
            ).id
          : (
              await this.prisma.deal.create({
                data: {
                  orgId,
                  contactId,
                  stageId: stage.id,
                  title: formName ? `${name ?? "Lead"} · ${formName}` : (name ?? "Lead de Meta"),
                },
              })
            ).id;
      this.events.emit("deal.stage_changed", { orgId, dealId, contactId, stageId: stage.id });
      this.events.emit("pipeline.changed", { orgId, dealId });
    } catch (e) {
      this.logger.warn(`No se pudo crear la oportunidad: ${(e as Error).message}`);
    }
  }

  /**
   * Plantilla de bienvenida. Un lead nunca nos ha escrito, así que la ventana
   * de 24h está cerrada y solo una plantilla aprobada puede abrir el chat.
   */
  private async sendWelcome(
    orgId: string,
    contactId: string,
    templateId: string,
  ): Promise<void> {
    try {
      const conversation = await this.ensureConversation(orgId, contactId);
      await this.messaging.sendTemplateMessage(
        {
          conversationId: conversation,
          templateId,
          fill: {
            // {{1}} = nombre del contacto, que es el caso habitual.
            body: [{ index: 1, source: "contact_name" }],
            urlButtons: [],
          },
        },
        MessageAuthor.AI,
      );
    } catch (e) {
      this.logger.warn(
        `No se pudo enviar la bienvenida: ${(e as Error).message}`,
      );
    }
  }

  private async ensureConversation(
    orgId: string,
    contactId: string,
  ): Promise<string> {
    const open = await this.prisma.conversation.findFirst({
      where: { contactId, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" },
    });
    if (open) return open.id;
    const created = await this.prisma.conversation.create({
      data: { orgId, contactId, status: "OPEN" },
    });
    return created.id;
  }

  private async record(
    note: LeadgenNotification,
    pageId: string,
    fields: MetaLeadField[],
    extra: {
      status: MetaLeadStatusValue;
      error?: string;
      formName?: string | null;
      adName?: string | null;
      campaignName?: string | null;
      platform?: string | null;
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      contactId?: string;
    },
  ): Promise<void> {
    await this.prisma.metaLead.create({
      data: {
        leadgenId: note.leadgenId,
        pageId,
        formId: note.formId ?? null,
        formName: extra.formName ?? null,
        adId: note.adId ?? null,
        adName: extra.adName ?? null,
        campaignName: extra.campaignName ?? null,
        platform: extra.platform ?? null,
        fieldData: fields as unknown as Prisma.InputJsonValue,
        name: extra.name ?? null,
        phone: extra.phone ?? null,
        email: extra.email ?? null,
        status: extra.status,
        error: extra.error ?? null,
        contactId: extra.contactId ?? null,
      },
    });
  }

  // ── Bandeja de leads ───────────────────────────────────────
  async listLeads(status?: MetaLeadStatusValue): Promise<MetaLeadDto[]> {
    const rows = await this.prisma.metaLead.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { page: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      leadgenId: r.leadgenId,
      pageId: r.pageId,
      pageName: r.page.name,
      formName: r.formName,
      adName: r.adName,
      campaignName: r.campaignName,
      name: r.name,
      phone: r.phone,
      email: r.email,
      status: r.status as MetaLeadStatusValue,
      error: r.error,
      contactId: r.contactId,
      fields: (r.fieldData as MetaLeadField[] | null) ?? [],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Convierte a contacto un lead que llegó sin teléfono. */
  async convertLead(id: string, phone: string): Promise<{ contactId: string }> {
    const lead = await this.prisma.metaLead.findUnique({
      where: { id },
      include: { page: true },
    });
    if (!lead) throw new NotFoundException("Lead no encontrado");

    const fields = (lead.fieldData as MetaLeadField[] | null) ?? [];
    const mapped = { ...mapMetaLeadFields(fields, this.ruleFor(lead.page, lead.formId)?.fieldMap), phone };

    const contactId = await this.createContact(
      lead.page,
      mapped,
      lead.formName,
      { adName: lead.adName, campaignName: lead.campaignName },
      lead.formId,
    );

    await this.prisma.metaLead.update({
      where: { id },
      data: { status: "PROCESSED", phone, contactId, error: null },
    });
    return { contactId };
  }

  async discardLead(id: string): Promise<{ ok: true }> {
    const lead = await this.prisma.metaLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead no encontrado");
    await this.prisma.metaLead.delete({ where: { id } });
    return { ok: true };
  }
}
