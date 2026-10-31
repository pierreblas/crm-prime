import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  countryFromPhone,
  dialCodeOf,
  mapMetaLeadFields,
  phoneWithDefaultCountry,
  MessageAuthor,
  type MetaLeadDto,
  type MetaLeadField,
  type MetaLeadStatusValue,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { LeadService } from "../leads/lead.service";
import { MessagingService } from "../messaging/messaging.service";
import { MetaGraphClient } from "./meta-graph.client";

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
  ) {}

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

    const mapped = mapMetaLeadFields(detail.fields);
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

    const contactId = await this.createContact(page, mapped, formName, ad);

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
    page: {
      // Los leads llegan por webhook de Meta, sin petición del usuario detrás.
      // La empresa sale de la página conectada, que es quien recibió el lead.
      orgId: string;
      pageId: string;
      name: string;
      sourceId: string | null;
      tagIds: unknown;
      createDeal: boolean;
      welcomeTemplateId: string | null;
    },
    mapped: ReturnType<typeof mapMetaLeadFields>,
    formName: string | null,
    ad: { adName: string | null; campaignName: string | null } = { adName: null, campaignName: null },
  ): Promise<string> {
    const source = page.sourceId
      ? await this.prisma.source.findUnique({ where: { id: page.sourceId } })
      : null;
    const tagIds = Array.isArray(page.tagIds) ? (page.tagIds as string[]) : [];
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
      { via: "meta", formName },
    );

    if (page.createDeal) {
      await this.createDeal(page.orgId, contactId, mapped.name, formName);
    }
    if (page.welcomeTemplateId) {
      await this.sendWelcome(page.orgId, contactId, page.welcomeTemplateId);
    }

    return contactId;
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

  /** Oportunidad en la primera etapa del pipeline. */
  private async createDeal(
    orgId: string,
    contactId: string,
    name: string | null,
    formName: string | null,
  ): Promise<void> {
    // Primera etapa del embudo predeterminado.
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { pipeline: { isDefault: true } },
      orderBy: { order: "asc" },
    });
    if (!stage) {
      this.logger.warn("No hay etapas en el pipeline: no se creó la oportunidad");
      return;
    }
    await this.prisma.deal
      .create({
        data: {
          orgId,
          contactId,
          stageId: stage.id,
          title: formName
            ? `${name ?? "Lead"} · ${formName}`
            : (name ?? "Lead de Meta"),
        },
      })
      .catch((e: Error) =>
        this.logger.warn(`No se pudo crear la oportunidad: ${e.message}`),
      );
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
    const mapped = { ...mapMetaLeadFields(fields), phone };

    const contactId = await this.createContact(lead.page, mapped, lead.formName, {
      adName: lead.adName,
      campaignName: lead.campaignName,
    });

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
