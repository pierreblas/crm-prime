import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import type {
  ConversionChannel,
  ConversionEventDto,
  ConversionFormChannel,
  ConversionsOverview,
  EnableFormConversionsInput,
  StageConversionEvent,
} from "@crm/shared";
import { META_FORM_LEAD_EVENT, parseStageConversionEvents, readAdReferral } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";
import { decryptSecret, encryptSecret } from "../../common/utils/secret-box";

/** Un lead de formulario de Meta: su id y la página (el id de Meta) por la que entró. */
interface FormLeadRef {
  leadgenId: string;
  pageId: string;
}

interface StageChangedEvent {
  orgId: string;
  dealId: string;
  contactId: string;
  stageId: string;
  /**
   * La oportunidad acaba de nacer de este lead de formulario. Viene en el
   * aviso porque el lead todavía no está guardado cuando se crea su oportunidad.
   */
  metaLead?: FormLeadRef;
}

/** Entró un lead de formulario y ya tiene contacto. */
interface FormLeadReceivedEvent extends FormLeadRef {
  orgId: string;
  contactId: string;
}

/** A dónde van los eventos de un lead: el conjunto de datos de su página, con el token ya descifrado. */
interface FormTarget {
  leadgenId: string;
  metaPageId: string;
  datasetId: string;
  token: string;
}

/** Cómo se presenta Driony a Meta en los eventos de CRM (`lead_event_source`). */
const CRM_NAME = "Driony";

/**
 * El cuerpo de un evento de CRM para la Conversions API (integración
 * «Conversion Leads»): la etapa, cuándo se alcanzó y el id del lead. El id va
 * como número y tal cual llegó de Meta: tiene hasta 17 cifras y un Number de
 * JavaScript lo redondearía, así que no pasa por uno.
 */
export function crmEventBody(e: { eventName: string; eventId: string; leadgenId: string; at: Date; value: number | null; currency: string | null }): string {
  const LEAD = "@lead_id";
  const json = JSON.stringify({
    data: [
      {
        event_name: e.eventName,
        event_time: Math.floor(e.at.getTime() / 1000),
        event_id: e.eventId,
        action_source: "system_generated",
        user_data: { lead_id: LEAD },
        custom_data: {
          event_source: "crm",
          lead_event_source: CRM_NAME,
          ...(e.value != null ? { value: e.value, currency: e.currency } : {}),
        },
      },
    ],
  });
  return json.replace(`"lead_id":"${LEAD}"`, `"lead_id":${e.leadgenId}`);
}

/**
 * Conversiones de anuncios: las etapas del embudo que Driony devuelve a Meta
 * para que las campañas optimicen hacia clientes reales. Qué se envía en cada
 * etapa se elige en Ajustes › Embudos y etapas (LeadSubmitted, Purchase…,
 * varios por etapa). Hay dos vías, y un cliente puede contar en las dos:
 *
 *  - Anuncios Click to WhatsApp (Conversions API for Business Messaging). Cada
 *    número se activa por separado: al activarlo se obtiene (o se crea) el
 *    dataset de su cuenta de WhatsApp Business. Se atribuye con el ctwa_clid
 *    del clic. Requiere el permiso whatsapp_business_manage_events.
 *  - Formularios de Meta (Conversions API, integración de CRM). Cada página
 *    guarda el conjunto de datos (píxel) que el anunciante crea en el
 *    Administrador de eventos y el token que este genera; no hace falta ningún
 *    permiso de la app. Se atribuye con el id del lead. Además de las etapas,
 *    sale «Lead» en cuanto entra cada lead: Meta pide todas las etapas, también
 *    la inicial.
 */
@Injectable()
export class ConversionsService {
  private readonly logger = new Logger("Conversiones");
  private readonly version = process.env.WHATSAPP_GRAPH_VERSION ?? "v24.0";

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /** Base de la Graph API (sustituible en pruebas). */
  private graph(path: string): string {
    const base = (env("META_GRAPH_URL") ?? "https://graph.facebook.com").replace(/\/+$/, "");
    return `${base}/${this.version}/${path.replace(/^\/+/, "")}`;
  }

  // ── Configuración ───────────────────────────────────────────
  async overview(): Promise<ConversionsOverview> {
    const [channels, pages, events] = await Promise.all([
      this.prisma.whatsappConnection.findMany({
        where: { isActive: true },
        orderBy: { connectedAt: "asc" },
        select: { id: true, label: true, displayPhoneNumber: true, wabaId: true, capiEnabled: true, capiDatasetId: true },
      }),
      this.prisma.metaPage.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, capiEnabled: true, capiDatasetId: true, capiTokenEnc: true },
      }),
      this.prisma.conversionEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          deal: { select: { title: true } },
          contact: { select: { name: true, phone: true } },
          connection: { select: { label: true, displayPhoneNumber: true } },
          metaPage: { select: { name: true } },
        },
      }),
    ]);
    return {
      // El token no sale de aquí: solo si hay uno guardado.
      forms: pages.map(
        (p): ConversionFormChannel => ({ id: p.id, name: p.name, enabled: p.capiEnabled, datasetId: p.capiDatasetId, hasToken: !!p.capiTokenEnc }),
      ),
      channels: channels.map(
        (c): ConversionChannel => ({
          id: c.id,
          label: c.label,
          displayPhoneNumber: c.displayPhoneNumber,
          wabaId: c.wabaId,
          enabled: c.capiEnabled,
          datasetId: c.capiDatasetId,
        }),
      ),
      events: events.map(
        (e): ConversionEventDto => ({
          id: e.id,
          eventName: e.eventName,
          status: e.status === "sent" || e.status === "waiting" ? e.status : "failed",
          value: e.value == null ? null : Number(e.value),
          currency: e.currency,
          error: e.error,
          channel: e.channel === "form" ? "form" : "whatsapp",
          dealId: e.dealId,
          dealTitle: e.deal?.title ?? null,
          contactName: e.contact?.name ?? e.contact?.phone ?? null,
          channelLabel:
            e.channel === "form" ? (e.metaPage?.name ?? null) : (e.connection?.label ?? e.connection?.displayPhoneNumber ?? null),
          sentAt: e.sentAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
        }),
      ),
    };
  }

  /** Activa las conversiones en un número: obtiene o crea el dataset de su WABA. */
  async enable(connectionId: string): Promise<ConversionsOverview> {
    const conn = await this.prisma.whatsappConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException("Número no encontrado");
    if (!conn.wabaId || !conn.accessToken) {
      throw new BadRequestException("Este número no tiene cuenta de WhatsApp Business (WABA) o token: vuelve a conectarlo.");
    }
    const datasetId = conn.capiDatasetId ?? (await this.ensureDataset(conn.wabaId, conn.accessToken));
    await this.prisma.whatsappConnection.update({
      where: { id: conn.id },
      data: { capiEnabled: true, capiDatasetId: datasetId },
    });
    this.logger.log(`Conversiones activadas en ${conn.displayPhoneNumber ?? conn.id} (dataset ${datasetId})`);
    return this.overview();
  }

  async disable(connectionId: string): Promise<ConversionsOverview> {
    await this.prisma.whatsappConnection.update({ where: { id: connectionId }, data: { capiEnabled: false } }).catch(() => {
      throw new NotFoundException("Número no encontrado");
    });
    return this.overview();
  }

  /**
   * Conecta el conjunto de datos (píxel) de una página, o lo cambia. El
   * identificador y el token los copia el administrador del Administrador de
   * eventos de Meta; el token se guarda cifrado. Sin token nuevo se conserva
   * el que hubiera (para cambiar solo el conjunto de datos o volver a activar).
   */
  async enableForm(pageId: string, input: EnableFormConversionsInput): Promise<ConversionsOverview> {
    const page = await this.prisma.metaPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException("Página no encontrada");
    if (!input.accessToken && !page.capiTokenEnc) {
      throw new BadRequestException("Pega el token de acceso del conjunto de datos: se genera en el Administrador de eventos de Meta.");
    }
    await this.prisma.metaPage.update({
      where: { id: page.id },
      data: {
        capiEnabled: true,
        capiDatasetId: input.datasetId,
        ...(input.accessToken ? { capiTokenEnc: encryptSecret(input.accessToken) } : {}),
      },
    });
    this.logger.log(`Conversiones de formularios activadas en ${page.name} (conjunto de datos ${input.datasetId})`);
    return this.overview();
  }

  /** Deja de enviar los eventos de esa página. El conjunto de datos y el token se conservan. */
  async disableForm(pageId: string): Promise<ConversionsOverview> {
    const page = await this.prisma.metaPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException("Página no encontrada");
    await this.prisma.metaPage.update({ where: { id: page.id }, data: { capiEnabled: false } });
    return this.overview();
  }

  /** Dataset de la WABA: el que ya tenga o uno nuevo. */
  private async ensureDataset(wabaId: string, token: string): Promise<string> {
    const headers = { Authorization: `Bearer ${token}` };
    const got = await fetch(this.graph(`${wabaId}/dataset`), { headers });
    const gotBody = (await got.json().catch(() => ({}))) as { id?: string; data?: { id?: string }[]; error?: { message?: string } };
    const existing = gotBody.id ?? gotBody.data?.[0]?.id;
    if (got.ok && existing) return existing;
    const made = await fetch(this.graph(`${wabaId}/dataset`), { method: "POST", headers });
    const madeBody = (await made.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!made.ok || !madeBody.id) {
      const why = madeBody.error?.message ?? gotBody.error?.message ?? `HTTP ${made.status}`;
      throw new BadRequestException(
        `Meta no devolvió el dataset (${why}). Comprueba que la app tenga el permiso whatsapp_business_manage_events.`,
      );
    }
    return madeBody.id;
  }

  // ── Envío de eventos ────────────────────────────────────────
  @OnEvent("deal.stage_changed", { async: true })
  async onStage(e: StageChangedEvent): Promise<void> {
    if (!e.orgId) return;
    try {
      await runInOrg(e.orgId, () => this.report(e.dealId, e.contactId, e.stageId, e.metaLead));
    } catch (err) {
      this.logger.error(`Conversión de la oportunidad ${e.dealId}: ${(err as Error).message}`);
    }
  }

  /**
   * Entró un lead de formulario: sale «Lead», la primera etapa para Meta, sin
   * esperar a ninguna oportunidad. Una vez por lead.
   */
  @OnEvent("meta_lead.received", { async: true })
  async onLead(e: FormLeadReceivedEvent): Promise<void> {
    if (!e.orgId) return;
    try {
      await runInOrg(e.orgId, async () => {
        const target = await this.formTarget(e.contactId, e);
        if (target) await this.sendForm(null, e.contactId, { eventName: META_FORM_LEAD_EVENT, withValue: false }, target);
      });
    } catch (err) {
      this.logger.error(`Conversión del lead ${e.leadgenId}: ${(err as Error).message}`);
    }
  }

  /** La oportunidad ya tiene valor: salen las compras que lo esperaban. */
  @OnEvent("deal.value_changed", { async: true })
  async onValue(e: { orgId: string | null; dealId: string }): Promise<void> {
    if (!e.orgId) return;
    try {
      await runInOrg(e.orgId, async () => {
        const waiting = await this.prisma.conversionEvent.findMany({ where: { dealId: e.dealId, status: "waiting" } });
        // Solo espera valor la vía de WhatsApp (Meta lo exige en sus compras).
        for (const ev of waiting) if (ev.dealId) await this.send(ev.dealId, ev.contactId, { eventName: ev.eventName, withValue: true });
      });
    } catch (err) {
      this.logger.error(`Conversión de la oportunidad ${e.dealId}: ${(err as Error).message}`);
    }
  }

  /** Reintenta un evento que falló. */
  async retry(eventId: string): Promise<ConversionsOverview> {
    const ev = await this.prisma.conversionEvent.findUnique({ where: { id: eventId } });
    if (!ev) throw new NotFoundException("Evento no encontrado");
    const what = { eventName: ev.eventName, withValue: ev.value != null };
    if (ev.channel === "form") {
      // Con el mismo lead con el que se intentó, por la página que lo recibió.
      const page = ev.metaPageId ? await this.prisma.metaPage.findUnique({ where: { id: ev.metaPageId }, select: { pageId: true } }) : null;
      const target = await this.formTarget(ev.contactId, ev.leadgenId && page ? { leadgenId: ev.leadgenId, pageId: page.pageId } : undefined);
      if (!target) {
        throw new BadRequestException("Las conversiones de formularios de esa página están desactivadas o les falta el conjunto de datos: revísalo arriba y vuelve a intentarlo.");
      }
      await this.sendForm(ev.dealId, ev.contactId, what, target, { force: true });
    } else if (ev.dealId) {
      await this.send(ev.dealId, ev.contactId, what, { force: true });
    }
    return this.overview();
  }

  /**
   * El último clic en un anuncio que trae ctwa_clid, y el número que lo
   * recibió. Primero en los mensajes (cada clic queda en el mensaje que lo
   * trajo, también con el chat abierto); si no hay, en las conversaciones
   * (filas anteriores a guardar el referral por mensaje). Los anuncios de
   * Estados de WhatsApp no traen ctwa_clid: se saltan y cuenta el anterior.
   *
   * El referral se guarda en camelCase (ctwaClid); readAdReferral acepta
   * también la forma de Meta. Antes se buscaba solo ctwa_clid y ningún chat
   * real lo tenía: las conversiones no salían nunca.
   */
  private async lastAdClick(contactId: string): Promise<{ clid: string; channelId: string } | null> {
    const messages = await this.prisma.message.findMany({
      where: { conversation: { contactId }, direction: "INBOUND", referral: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { referral: true, conversation: { select: { channelId: true } } },
    });
    for (const m of messages) {
      const clid = readAdReferral(m.referral)?.ctwaClid;
      if (clid && m.conversation.channelId) return { clid, channelId: m.conversation.channelId };
    }
    const convos = await this.prisma.conversation.findMany({
      where: { contactId, referral: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { referral: true, channelId: true },
    });
    for (const c of convos) {
      const clid = readAdReferral(c.referral)?.ctwaClid;
      if (clid && c.channelId) return { clid, channelId: c.channelId };
    }
    return null;
  }

  /**
   * Todos los eventos configurados en la etapa, en orden; cada uno una sola
   * vez por oportunidad y vía: por el anuncio de WhatsApp del que vino el chat
   * y por el formulario de Meta que llenó, lo que tenga.
   */
  private async report(dealId: string, contactId: string, stageId: string, lead?: FormLeadRef): Promise<void> {
    const stage = await this.prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: { conversionEvents: true },
    });
    const events = parseStageConversionEvents(stage?.conversionEvents);
    if (!events.length) return;
    const form = await this.formTarget(contactId, lead);
    for (const ev of events) {
      await this.send(dealId, contactId, ev);
      if (form) await this.sendForm(dealId, contactId, ev, form);
    }
  }

  /**
   * El lead de formulario al que se atribuyen las etapas del contacto (el
   * indicado o, si no, el último que llenó) y el conjunto de datos de su
   * página. Null si no llenó ninguno, si esa página no tiene las conversiones
   * activas o si el id no es de Meta (un lead de prueba): Meta lo rechazaría.
   */
  private async formTarget(contactId: string, hint?: FormLeadRef): Promise<FormTarget | null> {
    const lead =
      hint ??
      (await this.prisma.metaLead.findFirst({
        where: { contactId, status: "PROCESSED" },
        orderBy: { createdAt: "desc" },
        select: { leadgenId: true, pageId: true },
      }));
    if (!lead || !/^\d{1,20}$/.test(lead.leadgenId)) return null;
    const page = await this.prisma.metaPage.findUnique({
      where: { pageId: lead.pageId },
      select: { id: true, name: true, capiEnabled: true, capiDatasetId: true, capiTokenEnc: true },
    });
    if (!page?.capiEnabled || !page.capiDatasetId || !page.capiTokenEnc) return null;
    const token = decryptSecret(page.capiTokenEnc);
    if (!token) {
      this.logger.warn(`No se pudo leer el token del conjunto de datos de ${page.name}: vuelve a pegarlo en Ajustes › Integraciones.`);
      return null;
    }
    return { leadgenId: lead.leadgenId, metaPageId: page.id, datasetId: page.capiDatasetId, token };
  }

  /**
   * Un evento de un lead de formulario, al conjunto de datos de su página.
   * `dealId` null es el «Lead» de llegada, que va por lead y no por
   * oportunidad. A diferencia de WhatsApp, la compra no espera el valor: para
   * Meta es la etapa del embudo y la necesita; si la oportunidad ya lo tiene,
   * lo lleva.
   */
  private async sendForm(
    dealId: string | null,
    contactId: string,
    ev: StageConversionEvent,
    target: FormTarget,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const eventName = ev.eventName;
    const existing = dealId
      ? await this.prisma.conversionEvent.findUnique({ where: { dealId_eventName_channel: { dealId, eventName, channel: "form" } } })
      : await this.prisma.conversionEvent.findFirst({ where: { dealId: null, channel: "form", eventName, leadgenId: target.leadgenId } });
    if (existing?.status === "sent" && !opts.force) return; // una vez por oportunidad (o lead) y evento

    const wantsValue = !!dealId && (eventName === "Purchase" || ev.withValue);
    const deal = wantsValue ? await this.prisma.deal.findUnique({ where: { id: dealId! }, select: { value: true, currency: true } }) : null;
    const amount = Number(deal?.value ?? 0);
    const value = amount > 0 ? amount : null;
    const currency = value != null ? (deal?.currency ?? "USD") : null;

    let status: "sent" | "failed" = "failed";
    let error: string | null = null;
    try {
      const res = await fetch(this.graph(`${target.datasetId}/events`), {
        method: "POST",
        headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
        body: crmEventBody({
          eventName,
          // El mismo id en cada reintento: Meta se queda con uno solo.
          eventId: dealId ? `${dealId}:${eventName}` : `lead:${target.leadgenId}`,
          leadgenId: target.leadgenId,
          at: new Date(),
          value,
          currency,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string; error_user_msg?: string } };
      if (res.ok && (body.events_received ?? 1) > 0) status = "sent";
      else error = body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message;
    }

    const data = {
      status,
      error: error?.slice(0, 500) ?? null,
      value,
      currency,
      metaPageId: target.metaPageId,
      leadgenId: target.leadgenId,
      sentAt: status === "sent" ? new Date() : null,
    };
    const create = { orgId: this.tenant.orgId(), dealId, contactId, eventName, channel: "form", ...data };
    if (dealId) {
      await this.prisma.conversionEvent.upsert({ where: { dealId_eventName_channel: { dealId, eventName, channel: "form" } }, create, update: data });
    } else if (existing) {
      await this.prisma.conversionEvent.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.conversionEvent.create({ data: create });
    }
    const whose = dealId ? `oportunidad ${dealId}` : `lead ${target.leadgenId}`;
    if (status === "sent") this.logger.log(`${eventName} enviado a Meta por formulario (${whose})`);
    else this.logger.warn(`${eventName} no se pudo enviar a Meta por formulario (${whose}): ${error}`);
  }

  private async send(
    dealId: string,
    contactId: string,
    ev: StageConversionEvent,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const eventName = ev.eventName;
    const fromAd = await this.lastAdClick(contactId);
    if (!fromAd) return; // no vino de un anuncio: nada que atribuir
    const { clid } = fromAd;

    const conn = await this.prisma.whatsappConnection.findUnique({ where: { id: fromAd.channelId } });
    if (!conn?.capiEnabled || !conn.capiDatasetId || !conn.wabaId || !conn.accessToken) return;

    const existing = await this.prisma.conversionEvent.findUnique({ where: { dealId_eventName_channel: { dealId, eventName, channel: "whatsapp" } } });
    if (existing?.status === "sent" && !opts.force) return; // una vez por oportunidad y evento

    // Purchase lleva valor y moneda siempre (Meta los exige); el resto, si se pidió.
    const withValue = eventName === "Purchase" || ev.withValue;
    const deal = withValue
      ? await this.prisma.deal.findUnique({ where: { id: dealId }, select: { value: true, currency: true } })
      : null;
    const value = withValue ? Number(deal?.value ?? 0) : null;
    const currency = withValue ? (deal?.currency ?? "USD") : null;

    // Una compra sin valor no se manda: Meta aprendería que vale 0 y, como sale
    // una sola vez, ya no se corregiría. Queda esperando y sale en cuanto la
    // oportunidad tenga valor (onValue).
    if (eventName === "Purchase" && !(value! > 0)) {
      const waiting = { status: "waiting", error: null, value: null, currency, connectionId: conn.id, sentAt: null };
      await this.prisma.conversionEvent.upsert({
        where: { dealId_eventName_channel: { dealId, eventName, channel: "whatsapp" } },
        create: { orgId: this.tenant.orgId(), dealId, contactId, eventName, ...waiting },
        update: waiting,
      });
      this.logger.log(`${eventName} espera el valor de la oportunidad ${dealId}`);
      return;
    }
    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "business_messaging",
          messaging_channel: "whatsapp",
          user_data: { whatsapp_business_account_id: conn.wabaId, ctwa_clid: clid },
          ...(withValue ? { custom_data: { currency, value } } : {}),
        },
      ],
    };

    let status: "sent" | "failed" = "failed";
    let error: string | null = null;
    try {
      const res = await fetch(this.graph(`${conn.capiDatasetId}/events`), {
        method: "POST",
        headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
      if (res.ok && (body.events_received ?? 1) > 0) status = "sent";
      else error = body.error?.message ?? `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message;
    }

    const data = {
      status,
      error,
      value,
      currency,
      connectionId: conn.id,
      sentAt: status === "sent" ? new Date() : null,
    };
    await this.prisma.conversionEvent.upsert({
      where: { dealId_eventName_channel: { dealId, eventName, channel: "whatsapp" } },
      create: { orgId: this.tenant.orgId(), dealId, contactId, eventName, ...data },
      update: data,
    });
    if (status === "sent") this.logger.log(`${eventName} enviado a Meta (oportunidad ${dealId})`);
    else this.logger.warn(`${eventName} no se pudo enviar a Meta (oportunidad ${dealId}): ${error}`);
  }
}
