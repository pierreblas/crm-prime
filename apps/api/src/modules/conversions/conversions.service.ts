import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import type { ConversionChannel, ConversionEventDto, ConversionsOverview, StageConversionEvent } from "@crm/shared";
import { parseStageConversionEvents } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";

interface StageChangedEvent {
  orgId: string;
  dealId: string;
  contactId: string;
  stageId: string;
}

/**
 * Conversiones de anuncios (Conversions API for Business Messaging de Meta).
 *
 * Cada número de WhatsApp se activa por separado: al activarlo se obtiene (o
 * se crea) el dataset de su cuenta de WhatsApp Business. Después, cuando una
 * oportunidad cuyo chat nació de un anuncio Click to WhatsApp (tiene
 * ctwa_clid) llega a una etapa, se envían a Meta los eventos configurados en
 * esa etapa (Ajustes › Embudos y etapas: LeadSubmitted, Purchase, Contact…,
 * varios por etapa). Así las campañas optimizan hacia clientes reales.
 * Requiere el permiso whatsapp_business_manage_events.
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
    const [channels, events] = await Promise.all([
      this.prisma.whatsappConnection.findMany({
        where: { isActive: true },
        orderBy: { connectedAt: "asc" },
        select: { id: true, label: true, displayPhoneNumber: true, wabaId: true, capiEnabled: true, capiDatasetId: true },
      }),
      this.prisma.conversionEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          deal: { select: { title: true } },
          contact: { select: { name: true, phone: true } },
          connection: { select: { label: true, displayPhoneNumber: true } },
        },
      }),
    ]);
    return {
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
          status: e.status === "sent" ? "sent" : "failed",
          value: e.value == null ? null : Number(e.value),
          currency: e.currency,
          error: e.error,
          dealId: e.dealId,
          dealTitle: e.deal?.title ?? null,
          contactName: e.contact?.name ?? e.contact?.phone ?? null,
          channelLabel: e.connection?.label ?? e.connection?.displayPhoneNumber ?? null,
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
      await runInOrg(e.orgId, () => this.report(e.dealId, e.contactId, e.stageId));
    } catch (err) {
      this.logger.error(`Conversión de la oportunidad ${e.dealId}: ${(err as Error).message}`);
    }
  }

  /** Reintenta un evento que falló. */
  async retry(eventId: string): Promise<ConversionsOverview> {
    const ev = await this.prisma.conversionEvent.findUnique({ where: { id: eventId } });
    if (!ev) throw new NotFoundException("Evento no encontrado");
    await this.send(ev.dealId, ev.contactId, { eventName: ev.eventName, withValue: ev.value != null }, { force: true });
    return this.overview();
  }

  /** Todos los eventos configurados en la etapa, en orden; cada uno una sola vez por oportunidad. */
  private async report(dealId: string, contactId: string, stageId: string): Promise<void> {
    const stage = await this.prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: { conversionEvents: true },
    });
    const events = parseStageConversionEvents(stage?.conversionEvents);
    for (const ev of events) await this.send(dealId, contactId, ev);
  }

  private async send(
    dealId: string,
    contactId: string,
    ev: StageConversionEvent,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const eventName = ev.eventName;
    // El chat que vino de un anuncio (el más reciente con ctwa_clid).
    const convos = await this.prisma.conversation.findMany({
      where: { contactId, referral: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { referral: true, channelId: true },
    });
    const fromAd = convos.find((c) => typeof (c.referral as { ctwa_clid?: unknown } | null)?.ctwa_clid === "string");
    const clid = (fromAd?.referral as { ctwa_clid?: string } | null)?.ctwa_clid;
    if (!fromAd || !clid || !fromAd.channelId) return; // no vino de un anuncio: nada que atribuir

    const conn = await this.prisma.whatsappConnection.findUnique({ where: { id: fromAd.channelId } });
    if (!conn?.capiEnabled || !conn.capiDatasetId || !conn.wabaId || !conn.accessToken) return;

    const existing = await this.prisma.conversionEvent.findUnique({ where: { dealId_eventName: { dealId, eventName } } });
    if (existing?.status === "sent" && !opts.force) return; // una vez por oportunidad y evento

    // Purchase lleva valor y moneda siempre (Meta los exige); el resto, si se pidió.
    const withValue = eventName === "Purchase" || ev.withValue;
    const deal = withValue
      ? await this.prisma.deal.findUnique({ where: { id: dealId }, select: { value: true, currency: true } })
      : null;
    const value = withValue ? Number(deal?.value ?? 0) : null;
    const currency = withValue ? (deal?.currency ?? "USD") : null;
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
      where: { dealId_eventName: { dealId, eventName } },
      create: { orgId: this.tenant.orgId(), dealId, contactId, eventName, ...data },
      update: data,
    });
    if (status === "sent") this.logger.log(`${eventName} enviado a Meta (oportunidad ${dealId})`);
    else this.logger.warn(`${eventName} no se pudo enviar a Meta (oportunidad ${dealId}): ${error}`);
  }
}
